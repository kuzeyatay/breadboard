from __future__ import annotations

import math
from dataclasses import dataclass

GESTURE_ACTIONS = {"voice", "scroll_up", "scroll_down", "disabled"}


@dataclass(slots=True)
class AirCursorConfig:
    camera_index: int = 0
    camera_width: int = 640
    camera_height: int = 480
    preferred_hand: str = "Auto"
    drag_hold_ms: int = 650
    scroll_enabled: bool = True
    mirror_preview: bool = True
    margin_x: float = 0.06
    margin_y: float = 0.06
    min_cutoff: float = 1.25
    beta: float = 0.018
    derivative_cutoff: float = 1.0
    pointer_gain: float = 1.0
    monitor: str = "external"
    monitor_device_id: str | None = None
    start_paused: bool = True
    scroll_rate: float = 480.0
    navigation_profile: str = "auto"
    orbit_gain: float = 240.0
    zoom_gain: float = 8.0
    invert_zoom: bool = False
    smoothing: float | None = None
    pinch_threshold: float = 0.32
    pinch_action: str = "left_click"
    gesture_confirm_ms: int = 200
    fist_start_hold_ms: int = 3000
    fist_pause_hold_ms: int = 800
    v_action: str = "voice"
    bent_action: str = "scroll_down"
    straight_action: str = "scroll_up"
    v_while_paused: bool = False
    bent_while_paused: bool = False
    straight_while_paused: bool = False
    cad_rotate: bool = True
    cad_zoom: bool = True
    settings_revision: str = ""

    def validate(self) -> None:
        if self.camera_width <= 0 or self.camera_height <= 0:
            raise ValueError("Camera dimensions must be positive")
        if self.preferred_hand not in {"Auto", "Left", "Right"}:
            raise ValueError("preferred_hand must be Auto, Left, or Right")
        if not 0 <= self.margin_x < 0.5 or not 0 <= self.margin_y < 0.5:
            raise ValueError("Control margins must be in [0, 0.5)")
        if self.drag_hold_ms < 0:
            raise ValueError("drag_hold_ms cannot be negative")
        from .cad_profiles import PROFILES

        if self.navigation_profile != "auto" and self.navigation_profile not in PROFILES:
            raise ValueError("Unknown navigation_profile")
        if not 60 <= self.scroll_rate <= 2400 or not 20 <= self.orbit_gain <= 1000:
            raise ValueError("Scroll/orbit sensitivity is outside the supported range")
        if not 1 <= self.zoom_gain <= 30:
            raise ValueError("Zoom sensitivity must be between 1 and 30")
        ranges = {"pointer_gain": (0.4, 2.5), "pinch_threshold": (0.18, 0.40),
                  "gesture_confirm_ms": (100, 600), "fist_start_hold_ms": (1000, 5000),
                  "fist_pause_hold_ms": (400, 2000), "drag_hold_ms": (200, 1500)}
        if self.smoothing is not None:
            ranges["smoothing"] = (0, 100)
        for name, (low, high) in ranges.items():
            value = getattr(self, name)
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value) or not low <= value <= high):
                raise ValueError(f"{name} must be between {low} and {high}")
        if self.pinch_action not in {"left_click", "right_click", "disabled"}:
            raise ValueError("Unknown pinch action")
        if any(action not in GESTURE_ACTIONS
               for action in (self.v_action, self.bent_action, self.straight_action)):
            raise ValueError("Unknown gesture action")
        if any(not isinstance(getattr(self, key), bool) for key in
               ("cad_rotate", "cad_zoom", "invert_zoom", "scroll_enabled",
                "v_while_paused", "bent_while_paused", "straight_while_paused")):
            raise ValueError("Gesture switches must be boolean")
        if not isinstance(self.settings_revision, str) or len(self.settings_revision) > 64:
            raise ValueError("Invalid settings revision")


EDITABLE_SETTINGS = (
    "pointer_gain", "smoothing", "preferred_hand", "pinch_threshold", "pinch_action",
    "drag_hold_ms", "gesture_confirm_ms", "fist_start_hold_ms", "fist_pause_hold_ms",
    "v_action", "bent_action", "straight_action", "scroll_enabled", "scroll_rate",
    "v_while_paused", "bent_while_paused", "straight_while_paused",
    "cad_rotate", "cad_zoom", "orbit_gain", "zoom_gain", "invert_zoom",
)


def settings_view(config: AirCursorConfig) -> dict:
    settings = {key: getattr(config, key) for key in EDITABLE_SETTINGS}
    if settings["smoothing"] is None:
        settings["smoothing"] = round(max(0, min(100, (2.25 - config.min_cutoff) / 0.02)))
    return settings

