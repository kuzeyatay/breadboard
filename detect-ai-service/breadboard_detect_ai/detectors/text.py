"""Faithful Fast-DetectGPT and Binoculars adapters over one Falcon logit pass."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Callable

from ..assets import AssetStore, FALCON_BASE, FALCON_INSTRUCT, Progress
from ..calibration import binoculars_signal, fast_detect_signal, with_language_caveat
from ..contracts import DetectorSignal
from ..resources import ResourceProfile, release_model


class TextDetectorSuite:
    def __init__(
        self,
        assets: AssetStore,
        resources: ResourceProfile,
        *,
        binoculars_mode: str = "low-fpr",
        max_tokens: int = 512,
    ) -> None:
        if binoculars_mode not in {"low-fpr", "accuracy"}:
            raise ValueError("invalid Binoculars mode")
        self.assets = assets
        self.resources = resources
        self.binoculars_mode = binoculars_mode
        self.max_tokens = max(80, min(max_tokens, 2048))
        # A single Falcon-7B fp16 checkpoint needs roughly 14 GB before
        # allocator overhead. Keep image inference on a small GPU, but route
        # text to CPU in auto mode instead of predictably crashing the worker.
        self.device = (
            "cpu"
            if resources.accelerator == "cuda"
            and (resources.accelerator_memory_mb or 0) < 16_000
            else resources.device
        )
        self.dtype = "bfloat16" if self.device == "cpu" else resources.dtype
        self._loaded: list[object] = []

    def detect(
        self,
        text: str,
        progress: Progress,
        cancelled: Callable[[], bool],
    ) -> list[DetectorSignal]:
        started = time.monotonic()
        def guarded_progress(stage: str, detail: dict[str, object]) -> None:
            if cancelled():
                raise InterruptedError("cancelled")
            progress(stage, detail)

        base_id, base_revision = FALCON_BASE
        instruct_id, instruct_revision = FALCON_INSTRUCT
        base_path = self.assets.ensure_hf_snapshot(base_id, base_revision, guarded_progress)
        if cancelled():
            raise InterruptedError("cancelled")
        instruct_path = self.assets.ensure_hf_snapshot(
            instruct_id, instruct_revision, guarded_progress
        )
        if cancelled():
            raise InterruptedError("cancelled")

        import torch
        from transformers import AutoTokenizer

        guarded_progress("loading_model", {"detector": "text", "modelId": base_id})
        tokenizer = AutoTokenizer.from_pretrained(
            str(base_path), local_files_only=True, trust_remote_code=False
        )
        if tokenizer.pad_token_id is None:
            tokenizer.pad_token = tokenizer.eos_token
        encodings = tokenizer(
            [text],
            return_tensors="pt",
            padding=False,
            truncation=True,
            max_length=self.max_tokens,
            return_token_type_ids=False,
        )
        token_count = int(encodings.input_ids.shape[-1])
        if token_count < 80:
            explanation = (
                f"Only {token_count} model tokens were available; at least 80 are required "
                "for a responsible text-origin assessment."
            )
            return [
                DetectorSignal(
                    detector_id=detector_id,
                    detector_name=name,
                    modality="text",
                    status="skipped",
                    verdict="insufficient_evidence",
                    explanation=explanation,
                    token_count=token_count,
                )
                for detector_id, name in (
                    ("fast_detect_gpt", "Fast-DetectGPT"),
                    ("binoculars", "Binoculars"),
                )
            ]

        observer_logits = self._logits(base_path, encodings, base_id, guarded_progress)
        if cancelled():
            raise InterruptedError("cancelled")
        performer_logits = self._logits(
            instruct_path, encodings, instruct_id, guarded_progress
        )
        if cancelled():
            raise InterruptedError("cancelled")
        elapsed = int((time.monotonic() - started) * 1000)
        language = _language_hint(text)
        model_label = f"{base_id} + {instruct_id}"
        revision_label = f"{base_revision} + {instruct_revision}"
        guarded_progress("running_detector", {"detector": "Fast-DetectGPT"})
        try:
            fast_score = sampling_discrepancy_analytic(
                observer_logits, performer_logits, encodings.input_ids[:, 1:]
            )
            fast = fast_detect_signal(
                fast_score,
                profile="falcon-7b__falcon-7b-instruct",
                model_id=model_label,
                revision=revision_label,
                device=self.device,
                dtype=self.dtype,
                token_count=token_count,
                timing_ms=elapsed,
            )
        except Exception:
            fast = DetectorSignal(
                detector_id="fast_detect_gpt",
                detector_name="Fast-DetectGPT",
                modality="text",
                status="error",
                verdict="error",
                explanation="Fast-DetectGPT could not derive its discrepancy from the model outputs.",
                error_code="detector_failed",
                token_count=token_count,
            )
        guarded_progress("running_detector", {"detector": "Binoculars"})
        try:
            binoculars_score = binoculars_ratio(
                observer_logits,
                performer_logits,
                encodings.input_ids,
                encodings.attention_mask,
                tokenizer.pad_token_id,
            )
            binoculars = binoculars_signal(
                binoculars_score,
                mode=self.binoculars_mode,
                model_id=model_label,
                revision=revision_label,
                device=self.device,
                dtype=self.dtype,
                token_count=token_count,
                timing_ms=elapsed,
            )
        except Exception:
            binoculars = DetectorSignal(
                detector_id="binoculars",
                detector_name="Binoculars",
                modality="text",
                status="error",
                verdict="error",
                explanation="Binoculars could not derive its ratio from the model outputs.",
                error_code="detector_failed",
                token_count=token_count,
            )
        shared_caveat = (
            "Both text signals use the same Falcon model pair, so agreement is not fully independent evidence."
        )
        if fast.status == "ok":
            fast.caveats.append(shared_caveat)
        if binoculars.status == "ok":
            binoculars.caveats.append(shared_caveat)
        if self.device == "cpu" and self.resources.accelerator == "cuda":
            fallback = (
                "Text inference used system memory because the available GPU is too small for one Falcon-7B checkpoint."
            )
            if fast.status == "ok":
                fast.caveats.append(fallback)
            if binoculars.status == "ok":
                binoculars.caveats.append(fallback)
        return [with_language_caveat(fast, language), with_language_caveat(binoculars, language)]

    def _logits(self, model_path: Path, encodings: object, model_id: str, progress: Progress):
        import torch
        from transformers import AutoModelForCausalLM

        progress(
            "loading_model",
            {"detector": "text", "modelId": model_id, "device": self.device},
        )
        dtype = {
            "float16": torch.float16,
            "bfloat16": torch.bfloat16,
            "float32": torch.float32,
        }[self.resources.dtype]
        # CPU bfloat16 cuts the checkpoint's resident memory in half and Falcon
        # was upstream-calibrated at bfloat16. CUDA uses fp16 for compatibility.
        if self.device == "cpu":
            dtype = torch.bfloat16
        model = AutoModelForCausalLM.from_pretrained(
            str(model_path),
            local_files_only=True,
            trust_remote_code=False,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        )
        self._loaded = [model]
        model.to(self.device)
        model.eval()
        progress("running_model", {"modelId": model_id})
        device_inputs = {key: value.to(self.device) for key, value in encodings.items()}
        with torch.inference_mode():
            logits = model(**device_inputs).logits.detach().to("cpu", dtype=torch.float32)
        self.unload()
        return logits

    def unload(self) -> None:
        for model in self._loaded:
            release_model(model)
        self._loaded.clear()


def sampling_discrepancy_analytic(logits_score, logits_ref, labels) -> float:
    """Fast-DetectGPT's upstream analytic sampling discrepancy criterion."""
    import torch

    if logits_ref.shape[-1] != logits_score.shape[-1]:
        vocab = min(logits_ref.shape[-1], logits_score.shape[-1])
        logits_ref = logits_ref[..., :vocab]
        logits_score = logits_score[..., :vocab]
    score = torch.log_softmax(logits_score[:, :-1], dim=-1)
    reference = torch.softmax(logits_ref[:, :-1], dim=-1)
    labels = labels.unsqueeze(-1)
    observed = score.gather(dim=-1, index=labels).squeeze(-1)
    mean = (reference * score).sum(dim=-1)
    variance = (reference * torch.square(score)).sum(dim=-1) - torch.square(mean)
    denominator = variance.sum(dim=-1).clamp_min(1e-12).sqrt()
    return float(((observed.sum(dim=-1) - mean.sum(dim=-1)) / denominator).item())


def binoculars_ratio(observer_logits, performer_logits, input_ids, attention_mask, pad_id: int) -> float:
    """Binoculars' perplexity / cross-perplexity metric, including its masks."""
    import torch

    cross_entropy = torch.nn.CrossEntropyLoss(reduction="none")
    shifted_logits = performer_logits[..., :-1, :].contiguous()
    shifted_labels = input_ids[..., 1:].contiguous()
    shifted_mask = attention_mask[..., 1:].contiguous()
    perplexity = (
        cross_entropy(shifted_logits.transpose(1, 2), shifted_labels) * shifted_mask
    ).sum(1) / shifted_mask.sum(1)

    vocab = min(observer_logits.shape[-1], performer_logits.shape[-1])
    observer_probs = torch.softmax(observer_logits[..., :vocab], dim=-1).view(-1, vocab)
    performer_scores = performer_logits[..., :vocab].reshape(-1, vocab)
    soft_cross_entropy = cross_entropy(performer_scores, observer_probs).view(
        input_ids.shape[0], -1
    )
    padding_mask = (input_ids != pad_id).to(torch.uint8)
    cross_perplexity = (soft_cross_entropy * padding_mask).sum(1) / padding_mask.sum(1)
    return float((perplexity / cross_perplexity).item())


def _language_hint(text: str) -> str:
    letters = [character for character in text if character.isalpha()]
    if not letters:
        return "unknown"
    ascii_letters = sum(character.isascii() for character in letters)
    return "likely_english" if ascii_letters / len(letters) >= 0.92 else "non_english_or_mixed"
