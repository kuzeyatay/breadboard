from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Point:
    x: float
    y: float
    z: float = 0.0


@dataclass(frozen=True, slots=True)
class DetectedHand:
    landmarks: tuple[Point, ...]
    handedness: str
    confidence: float  # Left/right handedness certainty, not hand-presence confidence.
    tracking_id: str | None = None
    world_landmarks: tuple[Point, ...] | None = None
    image_aspect: float = 1.0

    def __post_init__(self) -> None:
        if len(self.landmarks) != 21:
            raise ValueError("MediaPipe hands must contain exactly 21 landmarks")
        if self.world_landmarks is not None and len(self.world_landmarks) != 21:
            raise ValueError("World hand coordinates must contain exactly 21 landmarks")

    @property
    def wrist(self) -> Point:
        return self.landmarks[0]

    @property
    def thumb_tip(self) -> Point:
        return self.landmarks[4]

    @property
    def index_tip(self) -> Point:
        return self.landmarks[8]

