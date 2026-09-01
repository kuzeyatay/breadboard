"""One-item detection pipeline. It never persists or logs input content."""

from __future__ import annotations

import base64
import binascii
import re
import time
from typing import Callable

from .aggregate import aggregate
from .assets import AssetStore, Progress
from .contracts import DetectAIResult, DetectorSignal
from .detectors import TextDetectorSuite, UniversalFakeDetect
from .resources import ResourceProfile

MAX_TEXT_CHARS = 100_000
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MIN_TEXT_TOKENS = 80


class DetectPipeline:
    def __init__(self, assets: AssetStore, resources: ResourceProfile, idle_timeout_seconds: int) -> None:
        self.assets = assets
        self.resources = resources
        self.idle_timeout_seconds = idle_timeout_seconds
        self._text: TextDetectorSuite | None = None
        self._image: UniversalFakeDetect | None = None

    def detect(
        self,
        request_id: str,
        item: dict[str, object],
        options: dict[str, object],
        progress: Progress,
        cancelled: Callable[[], bool],
    ) -> DetectAIResult:
        started = time.monotonic()
        item_id = _required_string(item, "id", 200)
        name = _required_string(item, "name", 500)
        modality = item.get("modality")
        if modality not in {"text", "image"}:
            raise ValueError("modality must be text or image")
        progress("validating", {"itemId": item_id, "modality": modality})
        if cancelled():
            raise InterruptedError("cancelled")

        provenance = []
        caveats = [
            "AI-origin detection is probabilistic evidence, not proof of who created an item.",
            "Editing, translation, paraphrasing, compression, and domain shift can change detector behavior.",
        ]
        if modality == "text":
            text = _required_string(item, "text", MAX_TEXT_CHARS, strip=False)
            estimated_tokens = _estimated_tokens(text)
            if estimated_tokens < MIN_TEXT_TOKENS:
                explanation = (
                    f"The text has about {estimated_tokens} tokens; at least {MIN_TEXT_TOKENS} are required. "
                    "No model assets were loaded."
                )
                signals = [
                    DetectorSignal(
                        detector_id=detector_id,
                        detector_name=detector_name,
                        modality="text",
                        status="skipped",
                        verdict="insufficient_evidence",
                        explanation=explanation,
                        token_count=estimated_tokens,
                    )
                    for detector_id, detector_name in (
                        ("fast_detect_gpt", "Fast-DetectGPT"),
                        ("binoculars", "Binoculars"),
                    )
                ]
            else:
                mode = str(options.get("binocularsMode") or "low-fpr")
                max_tokens = int(options.get("maxTextTokens") or 512)
                self._text = TextDetectorSuite(
                    self.assets,
                    self.resources,
                    binoculars_mode=mode,
                    max_tokens=max_tokens,
                )
                try:
                    signals = self._text.detect(text, progress, cancelled)
                except InterruptedError:
                    raise
                except Exception as error:
                    signals = _text_failure_signals(error)
        else:
            encoded = _required_string(item, "imageBase64", MAX_IMAGE_BYTES * 2, strip=False)
            try:
                image_bytes = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError("imageBase64 is invalid") from error
            if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
                raise ValueError("image exceeds the 20 MB input limit")
            self._image = UniversalFakeDetect(self.assets, self.resources)
            try:
                signal, provenance = self._image.detect(image_bytes, progress, cancelled)
                signals = [signal]
            except InterruptedError:
                raise
            except Exception as error:
                signals = [
                    DetectorSignal(
                        detector_id="universal_fake_detect",
                        detector_name="UniversalFakeDetect",
                        modality="image",
                        status="error",
                        verdict="error",
                        explanation="The image detector could not produce a signal.",
                        error_code=_safe_error_code(error),
                    )
                ]

        verdict, confidence, degraded, summary = aggregate(signals)
        progress("aggregating", {"itemId": item_id})
        return DetectAIResult(
            schema_version=1,
            request_id=request_id,
            item_id=item_id,
            name=name,
            modality=modality,
            verdict=verdict,
            confidence=confidence,
            summary=summary,
            signals=signals,
            provenance=provenance,
            caveats=caveats,
            degraded=degraded,
            timing_ms=int((time.monotonic() - started) * 1000),
        )

    def unload(self) -> None:
        if self._text:
            self._text.unload()
            self._text = None
        if self._image:
            self._image.unload()
            self._image = None


def _estimated_tokens(text: str) -> int:
    # Conservative preflight only. Borderline inputs are left to the real
    # tokenizer; clearly short inputs avoid a multi-gigabyte first-use download.
    return len(re.findall(r"\w+|[^\w\s]", text, flags=re.UNICODE))


def _required_string(
    value: dict[str, object], key: str, maximum: int, *, strip: bool = True
) -> str:
    candidate = value.get(key)
    if not isinstance(candidate, str) or len(candidate) > maximum:
        raise ValueError(f"{key} is missing or too large")
    result = candidate.strip() if strip else candidate
    if not result:
        raise ValueError(f"{key} is required")
    return result


def _safe_error_code(error: Exception) -> str:
    text = str(error).lower()
    if "checksum" in text or "corrupt" in text:
        return "asset_verification_failed"
    if "out of memory" in text or "alloc" in text:
        return "resource_exhausted"
    if "download" in text or "connection" in text or "huggingface" in text:
        return "asset_download_failed"
    if "invalid_image" in text or "image" in text:
        return "invalid_image"
    return "detector_failed"


def _text_failure_signals(error: Exception) -> list[DetectorSignal]:
    code = _safe_error_code(error)
    return [
        DetectorSignal(
            detector_id=detector_id,
            detector_name=name,
            modality="text",
            status="error",
            verdict="error",
            explanation="The detector could not produce a signal.",
            error_code=code,
        )
        for detector_id, name in (
            ("fast_detect_gpt", "Fast-DetectGPT"),
            ("binoculars", "Binoculars"),
        )
    ]
