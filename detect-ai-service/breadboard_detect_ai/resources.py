"""Hardware selection and deterministic model cleanup."""

from __future__ import annotations

import gc
import os
import platform
from dataclasses import asdict, dataclass


@dataclass(frozen=True, slots=True)
class ResourceProfile:
    device: str
    dtype: str
    accelerator: str
    accelerator_memory_mb: int | None
    system_memory_mb: int | None
    sequential_text_models: bool

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def detect_resources(requested: str = "auto") -> ResourceProfile:
    import torch

    device = "cpu"
    accelerator = "cpu"
    accelerator_memory_mb: int | None = None
    dtype = "float32"

    normalized = requested.strip().lower()
    if normalized not in {"auto", "cpu", "cuda", "mps"}:
        raise ValueError("device must be auto, cpu, cuda, or mps")
    if normalized in {"auto", "cuda"} and torch.cuda.is_available():
        device = "cuda:0"
        accelerator = "cuda"
        dtype = "float16"
        accelerator_memory_mb = int(
            torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)
        )
    elif normalized in {"auto", "mps"} and getattr(torch.backends, "mps", None):
        if torch.backends.mps.is_available():
            device = "mps"
            accelerator = "mps"
            dtype = "float16"
    elif normalized in {"cuda", "mps"}:
        raise RuntimeError(f"requested {normalized} device is unavailable")

    system_memory_mb = _system_memory_mb()
    # Two Falcon-7B checkpoints do not fit together on ordinary consumer GPUs.
    sequential = accelerator_memory_mb is None or accelerator_memory_mb < 30_000
    return ResourceProfile(
        device=device,
        dtype=dtype,
        accelerator=accelerator,
        accelerator_memory_mb=accelerator_memory_mb,
        system_memory_mb=system_memory_mb,
        sequential_text_models=sequential,
    )


def release_model(model: object | None) -> None:
    if model is not None:
        del model
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        mps = getattr(torch, "mps", None)
        if mps and hasattr(mps, "empty_cache"):
            mps.empty_cache()
    except Exception:
        pass


def _system_memory_mb() -> int | None:
    try:
        if platform.system() == "Windows":
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ("length", ctypes.c_ulong),
                    ("memory_load", ctypes.c_ulong),
                    ("total_phys", ctypes.c_ulonglong),
                    ("avail_phys", ctypes.c_ulonglong),
                    ("total_page", ctypes.c_ulonglong),
                    ("avail_page", ctypes.c_ulonglong),
                    ("total_virtual", ctypes.c_ulonglong),
                    ("avail_virtual", ctypes.c_ulonglong),
                    ("avail_extended_virtual", ctypes.c_ulonglong),
                ]

            status = MemoryStatus()
            status.length = ctypes.sizeof(status)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
            return int(status.total_phys / (1024 * 1024))
        pages = os.sysconf("SC_PHYS_PAGES")
        size = os.sysconf("SC_PAGE_SIZE")
        return int(pages * size / (1024 * 1024))
    except Exception:
        return None
