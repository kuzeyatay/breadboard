"""The model itself: loaded late, held briefly, given back.

Two constraints shape everything here. The card is 6 GB and ComfyUI wants it
too, so the weights must not sit on it between questions. And `import torch` is
seconds and hundreds of megabytes on its own, so it must not happen when the
service merely starts — a supervisor that launches this at boot should pay
nothing until someone attaches a document.

Hence: nothing is imported until the first request, the model is loaded on
demand, and an idle timer hands the VRAM back. The cost is a cold first query
after a quiet spell, which is the right trade when the alternative is a gigabyte
of someone else's memory held against a question nobody asked.
"""

from __future__ import annotations

import base64
import binascii
import io
import threading
from typing import Any

import numpy as np

from . import DEFAULT_BATCH_SIZE, DEFAULT_MODEL_ID

#: How long the weights stay resident after the last request.
IDLE_UNLOAD_SECONDS = 600.0


class EmbedderError(RuntimeError):
    """A failure worth reporting to the caller rather than crashing on."""


def decode_page_image(image_base64: str) -> "Any":
    """Base64 (with or without a data-URL prefix) to a PIL image in RGB."""
    from PIL import Image, UnidentifiedImageError

    payload = image_base64
    if payload.startswith("data:"):
        _, _, payload = payload.partition(",")
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as error:
        raise EmbedderError(f"page image is not valid base64: {error}") from error
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (UnidentifiedImageError, OSError) as error:
        raise EmbedderError(f"page image could not be decoded: {error}") from error
    return image.convert("RGB")


class Embedder:
    """Owns the weights, the device, and the idle timer."""

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL_ID,
        batch_size: int = DEFAULT_BATCH_SIZE,
        idle_seconds: float = IDLE_UNLOAD_SECONDS,
    ) -> None:
        self.model_id = model_id
        self.batch_size = batch_size
        self._idle_seconds = idle_seconds
        self._lock = threading.RLock()
        self._model: Any = None
        self._processor: Any = None
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

    def probe(self) -> dict[str, str]:
        """What is installed, without loading a model.

        Importing torch here is deliberate and unavoidable — there is no way to
        report a CUDA version without it — but it happens only when something
        asks for health, not when the service starts.
        """
        report: dict[str, str] = {}
        try:
            import torch

            report["torch"] = torch.__version__
            report["cuda"] = torch.version.cuda or ""
            report["device"] = "cuda:0" if torch.cuda.is_available() else "cpu"
        except Exception as error:  # noqa: BLE001 - a broken install is a health state
            report["error"] = f"{type(error).__name__}: {error}"
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

            import torch
            from colpali_engine.models import ColIdefics3, ColIdefics3Processor

            # ColSmol is a SmolVLM checkpoint and SmolVLM is Idefics3, so these
            # are the classes that load it. There is no `ColSmol` class in
            # colpali-engine, whatever the project README suggests.
            use_cuda = torch.cuda.is_available()
            self._device = "cuda:0" if use_cuda else "cpu"
            # bfloat16 on the card, float32 on the CPU: most CPUs emulate
            # bfloat16 in software, which is slower than the full-width path it
            # was meant to save time over.
            torch_dtype = torch.bfloat16 if use_cuda else torch.float32
            self._dtype = "bfloat16" if use_cuda else "float32"

            try:
                self._model = ColIdefics3.from_pretrained(
                    self.model_id,
                    torch_dtype=torch_dtype,
                    device_map=self._device,
                ).eval()
                self._processor = ColIdefics3Processor.from_pretrained(self.model_id)
                self._load_error = ""
            except Exception as error:  # noqa: BLE001 - reported, not raised at boot
                self._model = None
                self._processor = None
                self._load_error = f"{type(error).__name__}: {error}"
                raise EmbedderError(f"the ColPali model could not be loaded: {error}") from error

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
            self._processor = None
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:  # noqa: BLE001 - unloading must not fail
                pass

    # -- work -------------------------------------------------------------
    def embed_pages(self, images: list[Any]) -> list[np.ndarray]:
        """One float16 array per page, shape (patches, dimensions)."""
        self.ensure_loaded()
        import torch

        out: list[np.ndarray] = []
        with self._lock:
            for start in range(0, len(images), self.batch_size):
                batch = images[start : start + self.batch_size]
                inputs = self._processor.process_images(batch).to(self._model.device)
                with torch.no_grad():
                    embeddings = self._model(**inputs)
                # Back to float32 before numpy: numpy has no bfloat16, and a
                # silent failure here would be a corrupt index rather than an
                # error.
                for row in embeddings:
                    out.append(row.to(torch.float32).cpu().numpy().astype(np.float16))
            self._touch()
        return out

    def score(self, query: str, page_vectors: list[np.ndarray]) -> list[float]:
        """Late-interaction scores for one query against a document's pages.

        The library's own `score_multi_vector` does the MaxSim. Reimplementing
        it would be the easiest place in this whole integration to be subtly,
        silently wrong.
        """
        self.ensure_loaded()
        import torch

        with self._lock:
            inputs = self._processor.process_queries([query]).to(self._model.device)
            with torch.no_grad():
                query_embedding = self._model(**inputs)
            pages = [
                torch.from_numpy(page.astype(np.float32)).to(query_embedding.dtype)
                for page in page_vectors
            ]
            scores = self._processor.score_multi_vector(
                query_embedding.to("cpu"),
                [page.to("cpu") for page in pages],
            )
            self._touch()
        return [float(value) for value in scores[0].tolist()]
