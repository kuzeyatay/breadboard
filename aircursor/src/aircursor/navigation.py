"""Contextual one-hand 3D navigation: wrist rotation and pinch aperture zoom."""
from __future__ import annotations

import math

from .cad_profiles import detect_profile
from .control_gestures import ControlResult
from .hand_geometry import palm_angles, pinch_distance


def angle_delta(value, previous):
    return (value - previous + math.pi) % (2 * math.pi) - math.pi


class Navigation:
    def __init__(self, controller, profile="auto", orbit_gain=240.0, zoom_gain=8.0,
                 invert_zoom=False, rotate_enabled=True, zoom_enabled=True):
        self.input = controller
        self.override = profile
        self.orbit_gain, self.zoom_gain = orbit_gain, zoom_gain
        self.zoom_sign = -1 if invert_zoom else 1
        self.rotate_enabled, self.zoom_enabled = rotate_enabled, zoom_enabled
        self.active = False
        self.profile = None
        self.window = 0
        self._angles = self._aperture = self._last = None
        self._zoom_pending = 0.0
        self._filtered_angles = self._filtered_aperture = None

    def suspend(self, disable=False):
        self.input.end_navigation()
        self._angles = self._aperture = self._last = None
        self._zoom_pending = 0.0
        self._filtered_angles = self._filtered_aperture = None
        if disable:
            self.active = False
            self.profile = None
            self.window = 0

    def update(self, hand, now, context) -> ControlResult:
        detected = detect_profile(context.executable, context.title, self.override)
        allowed = ((self.rotate_enabled or self.zoom_enabled) and detected is not None and not context.dialog
                   and self.input.navigation_allowed(context.window, context.bounds))
        if not allowed:
            was_active = self.active
            self.suspend(disable=True)
            # Consume the handoff frame so a zoom pinch cannot become a click in
            # the newly focused application. Normal controls resume next frame.
            return ControlResult(was_active, "3D stopped - normal controls" if was_active else "")
        if not self.active or context.window != self.window or detected != self.profile:
            self.suspend(disable=True)
            self.active, self.profile, self.window = True, detected, context.window
        if self._last is not None and not 0 < now - self._last <= 0.25:
            self.suspend()
        self._last = now
        if hand is None:
            self.suspend()
            return ControlResult(True, "3D: hand missing - controls released")
        angles, aperture = palm_angles(hand), pinch_distance(hand)
        if angles is None or not math.isfinite(aperture):
            self.suspend()
            return ControlResult(True, "3D: show your palm to the camera")
        aperture = max(0.0, min(1.6, aperture))
        if self._filtered_angles is not None:
            angles = tuple(old + 0.35 * angle_delta(new, old)
                           for new, old in zip(angles, self._filtered_angles, strict=True))
            aperture = self._filtered_aperture + 0.35 * (aperture - self._filtered_aperture)
        self._filtered_angles, self._filtered_aperture = angles, aperture
        if self._angles is None or self._aperture is None:
            self._angles, self._aperture = angles, aperture
            return ControlResult(True, f"AUTO 3D: {self.profile.name} - turn hand / pinch zoom")
        zoom = aperture - self._aperture
        if self.zoom_enabled and abs(zoom) > 0.035:
            # Zoom and orbit are exclusive; releasing orbit modifiers avoids accidental
            # Shift+wheel actions in apps with different navigation presets.
            self.input.end_navigation()
            self._zoom_pending += max(-0.18, min(0.18, zoom)) * self.zoom_gain
            self._angles, self._aperture = angles, aperture
            notches = int(self._zoom_pending)
            if notches:
                self.input.scroll(notches * self.zoom_sign * self.profile.zoom_sign)
                self._zoom_pending -= notches
            return ControlResult(True, f"3D ZOOM {'IN' if zoom > 0 else 'OUT'}: {self.profile.name}")
        dx, dy = (angle_delta(angles[i], self._angles[i]) for i in (0, 1))
        if self.rotate_enabled and (abs(dx) > 0.025 or abs(dy) > 0.025):
            # Reject discontinuous landmark flips, and cap one frame's movement.
            if abs(dx) > 0.65 or abs(dy) > 0.65:
                self.input.end_navigation()
            else:
                self.input.orbit(self.profile, self.window, context.bounds,
                                 max(-32, min(32, round(dx * self.orbit_gain))),
                                 max(-32, min(32, round(dy * self.orbit_gain))))
            self._angles, self._aperture = angles, aperture
        else:
            self.input.refresh_navigation()
        return ControlResult(True, f"3D ROTATE: {self.profile.name} | pinch gap: zoom")
