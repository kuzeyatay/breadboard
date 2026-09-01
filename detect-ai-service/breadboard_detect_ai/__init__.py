"""Breadboard Detect AI service.

Heavy ML dependencies are deliberately imported only by detector adapters. The
service can expose health and validate requests without loading torch or model
weights.
"""

from .contracts import DetectorSignal, DetectAIResult

__all__ = ["DetectorSignal", "DetectAIResult"]
__version__ = "1.0.0"
