"""Continuous mouse-wheel output while holding a bent or straight hand."""
from __future__ import annotations

from .control_gestures import ControlResult
from .models import DetectedHand
from .poses import HandPose, custom_pose


class HeldScroll:
    def __init__(self, controller, rate: float = 480.0, confirm: float = 0.20,
                 bindings: dict[HandPose, int] | None = None, pinch_exclusion: float = 0.46,
                 paused_poses: tuple[HandPose, ...] = ()):
        self.input = controller
        self.rate = rate
        self.confirm = confirm
        self.bindings = ({HandPose.BENT_HAND: -1, HandPose.STRAIGHT_HAND: 1}
                         if bindings is None else bindings)
        self.pinch_exclusion = pinch_exclusion
        self.paused_poses = paused_poses
        self.reset()

    def reset(self):
        self.direction = 0
        self.since = None
        self.last = None
        self.pending = 0.0
        self.pose = HandPose.NEUTRAL

    def update(self, hand: DetectedHand | None, now: float, *, paused: bool = False) -> ControlResult:
        if self.last is not None and not 0 < now - self.last <= 0.25:
            self.reset()
        previous = self.last
        self.last = now
        self.pose = custom_pose(hand, self.pose, self.pinch_exclusion)
        direction = (self.bindings.get(self.pose, 0)
                     if not paused or self.pose in self.paused_poses else 0)
        if not direction:
            self.reset()
            return ControlResult(False, "")
        label = "DOWN" if direction < 0 else "UP"
        if direction != self.direction:
            self.direction, self.since, self.pending = direction, now, 0.0
        if now - self.since < self.confirm:
            return ControlResult(True, f"Hold hand to scroll {label}")
        elapsed = min(0.1, now - max(previous or now, self.since + self.confirm))
        self.pending += direction * max(0.0, elapsed) * self.rate
        amount = int(self.pending)
        if amount:
            self.input.scroll_units(amount)
            self.pending -= amount
        return ControlResult(True, f"SCROLL {label} - relax fingers to stop")
