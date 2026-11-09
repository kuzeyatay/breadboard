"""Exclusive voice/pause gestures, with time-based confirmation and release."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .models import DetectedHand
from .poses import HandPose, custom_pose


class VoiceInput(Protocol):
    def voice_down(self) -> None: ...
    def voice_up(self) -> None: ...


@dataclass(frozen=True, slots=True)
class ControlResult:
    blocks_mouse: bool
    status: str


class ControlGestures:
    def __init__(self, input_controller: VoiceInput, *, paused: bool = False,
                 voice_confirm: float = 0.20, voice_release: float = 0.15,
                 fist_hold: float = 0.80, fist_rearm: float = 0.25,
                 fist_start_hold: float = 3.0,
                 voice_poses: tuple[HandPose, ...] = (HandPose.V_SIGN,),
                 paused_voice_poses: tuple[HandPose, ...] = (),
                 pinch_exclusion: float = 0.46) -> None:
        self.input = input_controller
        self.paused = paused
        self.voice_confirm = voice_confirm
        self.voice_release = voice_release
        self.fist_hold = fist_hold
        self.fist_start_hold = fist_start_hold
        self.fist_rearm = fist_rearm
        self.voice_held = False
        self.voice_poses = voice_poses
        self.paused_voice_poses = paused_voice_poses
        self.pinch_exclusion = pinch_exclusion
        self.pose = HandPose.NEUTRAL
        self._v_since: float | None = None
        self._last_v: float | None = None
        self._fist_since: float | None = None
        self._fist_latched = False
        self._fist_release_since: float | None = None
        self._last_frame: float | None = None

    def release_voice(self) -> None:
        self.input.voice_up()
        self.voice_held = False
        self._v_since = self._last_v = None

    def toggle_pause(self) -> None:
        self.release_voice()
        self.paused = not self.paused
        self._fist_latched = True
        self._fist_since = self._fist_release_since = None

    def reserves(self, hand: DetectedHand | None) -> bool:
        pose = custom_pose(hand, self.pose, self.pinch_exclusion)
        return pose is HandPose.FIST or pose in self.voice_poses

    def update(self, hand: DetectedHand | None, now: float) -> ControlResult:
        # Re-confirm after a stalled camera rather than extending a stale hold.
        if self._last_frame is not None and now - self._last_frame > 0.40:
            self.release_voice()
            self._fist_since = None
        self._last_frame = now
        pose = self.pose = custom_pose(hand, self.pose, self.pinch_exclusion)

        if pose is HandPose.FIST:
            self.release_voice()
            self._fist_release_since = None
            if self._fist_since is None:
                self._fist_since = now
            required_hold = self.fist_start_hold if self.paused else self.fist_hold
            elapsed = now - self._fist_since
            if not self._fist_latched and elapsed >= required_hold:
                self.toggle_pause()
            if self._fist_latched:
                status = "PAUSED - open your hand" if self.paused else "ON - open your hand"
            else:
                action = "START" if self.paused else "PAUSE"
                status = f"FIST: {action} in {max(0.0, required_hold - elapsed):.1f}s"
            return ControlResult(True, status)

        self._fist_since = None
        # Missing frames never rearm a fist that has already toggled.
        if hand is None:
            self._fist_release_since = None
        elif self._fist_latched:
            if self._fist_release_since is None:
                self._fist_release_since = now
            elif now - self._fist_release_since >= self.fist_rearm:
                self._fist_latched = False

        allowed_poses = self.paused_voice_poses if self.paused else self.voice_poses
        if pose in allowed_poses:
            self._last_v = now
            if self._v_since is None:
                self._v_since = now
            if self.voice_held or now - self._v_since >= self.voice_confirm:
                # Idempotent: refresh the safety lease, do not repeat key-downs.
                self.input.voice_down()
                self.voice_held = True
            return ControlResult(True, "VOICE: Ctrl+Shift held" if self.voice_held
                                 else "Gesture detected - hold to talk")

        self._v_since = None
        if self.voice_held and self._last_v is not None and now - self._last_v < self.voice_release:
            return ControlResult(True, "VOICE: Ctrl+Shift held")
        self.release_voice()
        if self.paused:
            return ControlResult(True, f"POINTER PAUSED - hold fist {self.fist_start_hold:g}s to start")
        return ControlResult(False, "")
