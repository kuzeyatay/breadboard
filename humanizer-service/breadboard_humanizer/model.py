"""The weights: loaded by the launcher, held briefly, given back.

The normal Breadboard launchers preload an installed checkpoint during their
startup sequence so the first rewrite does not pay the cold-load cost. Bare
service launches may still omit ``--preload`` for focused debugging.

The target machine has a 6 GB laptop card that ComfyUI also wants. BART-large is
~1.6 GB in float16, which fits comfortably and would still be an unreasonable
thing to hold overnight, hence the idle timer. On a machine with no CUDA the
same code runs in float32 on the CPU: slower by roughly an order of magnitude,
correct in every other respect.

Generation is deterministic - four beams, no sampling. Repeating the same
request must not become a slot machine, and the preservation gate downstream
needs a stable thing to check.

`Humanizer` is a Protocol so the server and the pipeline can be tested against a
fake that returns fixed strings. Nothing in the test suite downloads a
checkpoint.
"""

from __future__ import annotations

import os
import re
import threading
from typing import Any, Callable, Protocol

from . import (
    DEFAULT_IDLE_UNLOAD_SECONDS,
    DEFAULT_MODEL_ID,
    DEFAULT_MODEL_REVISION,
    MODEL_PREFIX,
)

Device = str  # "auto" | "cuda" | "cpu"


class ModelError(RuntimeError):
    """A failure worth answering with rather than crashing on."""


class ModelNotInstalledError(ModelError):
    """The checkpoint has never been downloaded on this machine."""


class Humanizer(Protocol):
    """What the server and pipeline need from a model."""

    model_id: str
    model_revision: str

    @property
    def loaded(self) -> bool: ...

    @property
    def device(self) -> str: ...

    @property
    def dtype(self) -> str: ...

    @property
    def load_error(self) -> str: ...

    def installed(self) -> bool: ...

    def probe(self) -> dict[str, str]: ...

    def count_tokens(self, text: str) -> int: ...

    def rewrite(self, texts: list[str], should_cancel: Callable[[], bool] | None = None) -> list[str]: ...

    def unload(self) -> None: ...


def hub_cache_directory() -> str:
    """Where the checkpoint lives on this machine.

    Breadboard points HF_HOME at its own mutable user-data area (see
    `desktop/src/main/service-definitions.ts`), which is what keeps a
    user-downloaded checkpoint out of the application resources and alive across
    an application update. The fallbacks below only matter for a bare
    `python -m breadboard_humanizer` outside Breadboard.
    """
    explicit = os.environ.get("HF_HUB_CACHE", "").strip()
    if explicit:
        return explicit
    home = os.environ.get("HF_HOME", "").strip()
    if home:
        return os.path.join(home, "hub")
    return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def model_is_installed(model_id: str) -> bool:
    """A path check, never a network call.

    "Not installed" is a first-class health state, and answering it must not
    take a round trip to huggingface.co on a machine that is offline by choice.
    """
    folder = "models--" + model_id.replace("/", "--")
    snapshots = os.path.join(hub_cache_directory(), folder, "snapshots")
    if not os.path.isdir(snapshots):
        return False
    for entry in os.listdir(snapshots):
        candidate = os.path.join(snapshots, entry)
        if os.path.isfile(os.path.join(candidate, "config.json")):
            return True
    return False


def resolve_device(requested: Device) -> tuple[str, str]:
    """(device, dtype), or an error when CUDA was asked for and is not there.

    An explicit `cuda` that quietly became `cpu` is the worst outcome available:
    the rewrite still works, twenty times slower, and the person who set it has
    no way to find out. So explicit means explicit.
    """
    try:
        import torch
    except Exception as error:  # noqa: BLE001 - a missing torch is a health state
        raise ModelError("PyTorch is not installed in the humanizer environment") from error

    available = torch.cuda.is_available()
    if requested == "cuda":
        if not available:
            raise ModelError("CUDA was requested but no CUDA device is available")
        return "cuda:0", "float16"
    if requested == "cpu":
        return "cpu", "float32"
    # float16 on the card, float32 on the CPU: most CPUs emulate half precision
    # in software, which is slower than the full-width path it would save.
    return ("cuda:0", "float16") if available else ("cpu", "float32")


def generation_budget(input_tokens: int) -> int:
    """`max_new_tokens` from the input, bounded at both ends.

    An unbounded ceiling on a rewriter is how a two-line paragraph becomes a
    page of loop. The floor keeps a short sentence from being truncated into
    nonsense that the length gate would then reject.
    """
    return max(32, min(256, int(input_tokens * 1.6) + 16))


class BartHumanizer:
    """The real model. One at a time, on demand, for five minutes."""

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL_ID,
        model_revision: str = DEFAULT_MODEL_REVISION,
        device: Device = "auto",
        idle_seconds: float = DEFAULT_IDLE_UNLOAD_SECONDS,
    ) -> None:
        self.model_id = model_id
        self.model_revision = model_revision
        self._requested_device = device
        self._idle_seconds = idle_seconds
        self._lock = threading.RLock()
        self._model: Any = None
        self._tokenizer: Any = None
        self._timer: threading.Timer | None = None
        self._device = "unknown"
        self._dtype = "unknown"
        self._load_error = ""

    # -- state a health check can read without loading anything -----------
    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def device(self) -> str:
        return self._device

    @property
    def dtype(self) -> str:
        return self._dtype

    @property
    def load_error(self) -> str:
        return self._load_error

    def installed(self) -> bool:
        return model_is_installed(self.model_id)

    def probe(self) -> dict[str, str]:
        """What is installed, without loading a model."""
        report: dict[str, str] = {}
        try:
            import torch

            report["torch"] = torch.__version__
            report["cuda"] = torch.version.cuda or ""
            report["device"] = "cuda:0" if torch.cuda.is_available() else "cpu"
        except Exception as error:  # noqa: BLE001 - a broken install is a health state
            report["error"] = type(error).__name__ + ": " + str(error)
        try:
            import transformers

            report["transformers"] = transformers.__version__
        except Exception as error:  # noqa: BLE001
            report.setdefault("error", type(error).__name__ + ": " + str(error))
        return report

    # -- loading ----------------------------------------------------------
    def _touch(self) -> None:
        """Restart the idle countdown. Called under the lock."""
        if self._timer is not None:
            self._timer.cancel()
        if self._idle_seconds <= 0:
            self._timer = None
            return
        self._timer = threading.Timer(self._idle_seconds, self.unload)
        self._timer.daemon = True
        self._timer.start()

    def ensure_loaded(self) -> None:
        with self._lock:
            if self._model is not None:
                self._touch()
                return
            if not self.installed():
                raise ModelNotInstalledError(
                    "the humanizer model is not downloaded on this machine"
                )

            try:
                import torch
                from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

                device, dtype_name = resolve_device(self._requested_device)
                torch_dtype = torch.float16 if dtype_name == "float16" else torch.float32

                # local_files_only: after installation, rewriting is an offline
                # operation. trust_remote_code stays false - a checkpoint must
                # never be able to run Python inside Breadboard's process.
                self._tokenizer = AutoTokenizer.from_pretrained(
                    self.model_id,
                    revision=self.model_revision,
                    local_files_only=True,
                    trust_remote_code=False,
                )
                self._model = AutoModelForSeq2SeqLM.from_pretrained(
                    self.model_id,
                    revision=self.model_revision,
                    dtype=torch_dtype,
                    local_files_only=True,
                    trust_remote_code=False,
                ).to(device)
                self._model.eval()
                self._device = device
                self._dtype = dtype_name
                self._load_error = ""
            except Exception as error:  # noqa: BLE001 - reported, not raised at boot
                self._model = None
                self._tokenizer = None
                self._load_error = type(error).__name__ + ": " + str(error)
                raise ModelError("the humanizer model could not be loaded: " + str(error)) from error

            self._touch()

    def unload(self) -> None:
        """Drop the weights and give the VRAM back."""
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            if self._model is None:
                return
            self._model = None
            self._tokenizer = None
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:  # noqa: BLE001 - unloading must not fail
                pass

    # -- work -------------------------------------------------------------
    def count_tokens(self, text: str) -> int:
        """Length in the model's own tokens.

        Character count is not a substitute: BPE turns a URL into thirty tokens
        and a common word into one, so a character budget either wastes most of
        the window or overruns it.
        """
        self.ensure_loaded()
        with self._lock:
            return len(self._tokenizer(text, add_special_tokens=True)["input_ids"])

    def rewrite(
        self, texts: list[str], should_cancel: Callable[[], bool] | None = None
    ) -> list[str]:
        self.ensure_loaded()
        import torch

        out: list[str] = []
        try:
            return self._generate(texts, should_cancel)
        except torch.cuda.CudaError as error:  # pragma: no cover - device fault
            # A CUDA fault leaves the context unusable: every later request on
            # these weights fails the same way, so the model is dropped and the
            # next rewrite reloads. Seen for real during development as
            # "CUDA error: unknown error" inside beam search on a card shared
            # with another local model.
            self.unload()
            raise ModelError("the GPU failed during generation: " + str(error)) from error
        except RuntimeError as error:  # pragma: no cover - device fault
            if "CUDA" not in str(error):
                raise
            self.unload()
            raise ModelError("the GPU failed during generation: " + str(error)) from error

    def _generate(
        self, texts: list[str], should_cancel: Callable[[], bool] | None
    ) -> list[str]:
        import torch

        out: list[str] = []
        with self._lock:
            for text in texts:
                if should_cancel is not None and should_cancel():
                    raise ModelError("cancelled")
                encoded = self._tokenizer(
                    MODEL_PREFIX + text,
                    return_tensors="pt",
                    truncation=True,
                    max_length=512,
                )
                encoded = {key: value.to(self._model.device) for key, value in encoded.items()}
                with torch.inference_mode():
                    generated = self._model.generate(
                        **encoded,
                        num_beams=4,
                        do_sample=False,
                        early_stopping=True,
                        max_new_tokens=generation_budget(int(encoded["input_ids"].shape[-1])),
                        no_repeat_ngram_size=4,
                    )
                out.append(
                    normalize_generated(
                        self._tokenizer.decode(generated[0], skip_special_tokens=True)
                    )
                )
            self._touch()
        return out


def normalize_generated(text: str) -> str:
    """Tidy what the decoder always does, and nothing else.

    Sentencepiece-style decoding leaves a leading space and can leave a space
    before punctuation. Both are decoding artefacts rather than the model's
    words, so fixing them here keeps the preservation gate from spending a
    rejection on whitespace. Nothing else about the wording is touched.
    """
    cleaned = text.strip()
    cleaned = re.sub(r"\s+([,.;:!?%])", r"\1", cleaned)
    # The decoder sometimes puts a space inside a placeholder. Closing that gap
    # is a decoding artefact repair, not a rewrite: the gate downstream still
    # decides whether the sequence came home intact.
    cleaned = re.sub(r"X\s?P\s?(\d+)\s?X", r"XP\1X", cleaned)
    return re.sub(r"[ \t]{2,}", " ", cleaned)
