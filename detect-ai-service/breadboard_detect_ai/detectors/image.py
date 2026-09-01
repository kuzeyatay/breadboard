"""UniversalFakeDetect adapter using its official CLIP preprocessing and head."""

from __future__ import annotations

import io
import time
from typing import Callable

from ..assets import (
    AssetStore,
    CLIP_SHA256,
    CLIP_URL,
    Progress,
    UNIVFD_HEAD_SHA256,
    UNIVFD_HEAD_URL,
)
from ..calibration import universal_fake_detect_signal
from ..contracts import DetectorSignal, ProvenanceSignal
from ..resources import ResourceProfile, release_model

MAX_IMAGE_PIXELS = 40_000_000


class UniversalFakeDetect:
    def __init__(self, assets: AssetStore, resources: ResourceProfile) -> None:
        self.assets = assets
        self.resources = resources
        self._model: object | None = None

    def detect(
        self,
        image_bytes: bytes,
        progress: Progress,
        cancelled: Callable[[], bool],
    ) -> tuple[DetectorSignal, list[ProvenanceSignal]]:
        started = time.monotonic()
        def guarded_progress(stage: str, detail: dict[str, object]) -> None:
            if cancelled():
                raise InterruptedError("cancelled")
            progress(stage, detail)

        from PIL import Image

        Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
        try:
            image = Image.open(io.BytesIO(image_bytes))
            image.verify()
            image = Image.open(io.BytesIO(image_bytes))
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError("image exceeds the decoded pixel limit")
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("unsupported image format")
            provenance = inspect_provenance(image)
            image = image.convert("RGB")
        except Exception as error:
            raise ValueError(f"invalid_image: {error}") from error

        clip_path = self.assets.ensure_url("ViT-L-14.pt", CLIP_URL, CLIP_SHA256, guarded_progress)
        head_path = self.assets.ensure_url(
            "universalfakedetect-fc_weights.pth",
            UNIVFD_HEAD_URL,
            UNIVFD_HEAD_SHA256,
            guarded_progress,
        )
        if cancelled():
            raise InterruptedError("cancelled")
        guarded_progress("loading_model", {"detector": "UniversalFakeDetect", "modelId": "CLIP:ViT-L/14"})
        import torch
        import torch.nn as nn
        import torchvision.transforms as transforms
        import open_clip

        model = open_clip.create_model("ViT-L-14", pretrained=None)
        open_clip.load_checkpoint(model, str(clip_path))
        head = nn.Linear(768, 1)
        state = torch.load(str(head_path), map_location="cpu", weights_only=True)
        head.load_state_dict(state)
        combined = _ImageDetector(model, head)
        dtype = torch.float16 if self.resources.device != "cpu" else torch.float32
        combined.to(self.resources.device, dtype=dtype)
        combined.eval()
        self._model = combined

        # This is intentionally the validation transform in UniversalFakeDetect:
        # CenterCrop only (no resize), then CLIP normalization.
        transform = transforms.Compose(
            [
                transforms.CenterCrop(224),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=[0.48145466, 0.4578275, 0.40821073],
                    std=[0.26862954, 0.26130258, 0.27577711],
                ),
            ]
        )
        tensor = transform(image).unsqueeze(0).to(self.resources.device, dtype=dtype)
        guarded_progress("running_detector", {"detector": "UniversalFakeDetect"})
        with torch.inference_mode():
            score = float(torch.sigmoid(combined(tensor)).flatten()[0].float().cpu().item())
        elapsed = int((time.monotonic() - started) * 1000)
        signal = universal_fake_detect_signal(
            score,
            model_id="OpenAI CLIP ViT-L/14 + UniversalFakeDetect linear head",
            revision=f"clip:{CLIP_SHA256};head:{UNIVFD_HEAD_SHA256}",
            device=self.resources.device,
            dtype=str(dtype).replace("torch.", ""),
            timing_ms=elapsed,
        )
        return signal, provenance

    def unload(self) -> None:
        release_model(self._model)
        self._model = None


def inspect_provenance(image: object) -> list[ProvenanceSignal]:
    info = getattr(image, "info", {}) or {}
    exif_fields: dict[str, str] = {}
    try:
        from PIL.ExifTags import TAGS

        for key, value in image.getexif().items():
            name = TAGS.get(key, str(key))
            if name in {"Software", "Make", "Model", "Artist", "ImageDescription"}:
                exif_fields[name] = str(value)[:500]
    except Exception:
        pass
    metadata_fields = {
        str(key): str(value)[:500]
        for key, value in info.items()
        if str(key).lower() in {"software", "prompt", "parameters", "workflow", "comment"}
    }
    fields = {**exif_fields, **metadata_fields}
    ai_markers = (
        "stable diffusion",
        "midjourney",
        "comfyui",
        "automatic1111",
        "dall-e",
        "firefly",
        "flux",
    )
    joined = " ".join(fields.values()).lower()
    if any(marker in joined for marker in ai_markers):
        return [
            ProvenanceSignal(
                kind="embedded_metadata",
                verdict="present",
                explanation="Embedded metadata contains a known generative-tool marker. This is provenance evidence, separate from the visual detector.",
                fields=fields,
            )
        ]
    return [
        ProvenanceSignal(
            kind="embedded_metadata",
            verdict="absent" if fields else "unknown",
            explanation=(
                "No recognized generative-tool marker was found in the retained metadata. Absence does not establish human origin."
            ),
            fields=fields,
        )
    ]


def _ImageDetector(clip_model: object, head: object):
    import torch.nn as nn

    class ImageDetector(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.clip_model = clip_model
            self.head = head

        def forward(self, value):
            return self.head(self.clip_model.encode_image(value))

    return ImageDetector()
