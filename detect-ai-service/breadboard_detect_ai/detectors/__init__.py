"""Lazy detector adapters."""

from .image import UniversalFakeDetect
from .text import TextDetectorSuite

__all__ = ["TextDetectorSuite", "UniversalFakeDetect"]
