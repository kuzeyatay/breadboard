from dataclasses import replace
from unittest.mock import Mock

import pytest
from test_control_gestures import FIST, OPEN, V, VoiceRecorder
from test_monitors import native  # noqa: F401 -- shared fake Windows boundary
from test_scroll_navigation import BENT, CONTEXT, RELAXED, Recorder

from aircursor.config import AirCursorConfig, settings_view
from aircursor.control_gestures import ControlGestures
from aircursor.gestures import GestureManager
from aircursor.held_scroll import HeldScroll
from aircursor.interaction import FrameInputController
from aircursor.models import Point
from aircursor.navigation import Navigation
from aircursor.pointer import PointerGain
from aircursor.poses import HandPose
from aircursor.runtime_settings import control_pipeline


def test_sensitivity_scales_real_distance_without_creeping_to_the_old_target():
    slow = PointerGain(0.5, bounds=(1920, 1080), anchor=lambda: (800, 500))
    fast = PointerGain(2, bounds=(1920, 1080), anchor=lambda: (800, 500))
    for gain in (slow, fast):
        assert gain.apply((100, 100)) == (800, 500)
    assert slow.apply((200, 120)) == (850, 510)
    assert fast.apply((200, 120)) == (1000, 540)
    for _ in range(30):
        assert slow.apply((200, 120)) == (850, 510)
    slow.reset()
    assert slow.apply((1600, 900)) == (800, 500)
    assert fast.apply((5000, 5000)) == (1919, 1079)
    assert fast.apply((4990, 4990)) == (1899, 1059)


@pytest.mark.parametrize("key,value", [
    ("pointer_gain", float("nan")), ("pointer_gain", 5), ("smoothing", -1),
    ("fist_start_hold_ms", 0), ("pinch_threshold", 0.9), ("v_action", "run_command"),
    ("cad_zoom", "false"), ("gesture_confirm_ms", True),
    ("v_while_paused", "false"), ("bent_while_paused", 1), ("straight_while_paused", None),
])
def test_invalid_preferences_are_rejected(key, value):
    with pytest.raises(ValueError):
        replace(AirCursorConfig(), **{key: value}).validate()


def test_gesture_mapping_moves_voice_to_straight_hand_and_fist_still_releases():
    recorder = VoiceRecorder()
    controls = ControlGestures(recorder, voice_poses=(HandPose.STRAIGHT_HAND,))
    for i in range(15):
        assert not controls.update(V, i * 0.04).blocks_mouse
    assert recorder.events == []
    for i in range(15, 30):
        controls.update(OPEN, i * 0.04)
    assert recorder.events == ["down"]
    controls.update(FIST, 1.2)
    assert recorder.events == ["down", "up"]


def test_scroll_reassignment_honors_directions_and_disabled_shapes():
    recorder = Recorder()
    scroll = HeldScroll(recorder, 240, bindings={HandPose.V_SIGN: -1, HandPose.BENT_HAND: 1})
    for i in range(20):
        scroll.update(V, i * 0.04)
    assert sum(recorder.wheel) < 0
    recorder.wheel.clear()
    for i in range(20, 40):
        scroll.update(BENT, i * 0.04)
    assert sum(recorder.wheel) > 0
    recorder.wheel.clear()
    assert not scroll.update(OPEN, 1.7).blocks_mouse
    assert recorder.wheel == []


@pytest.mark.parametrize("action,expected", [("right_click", [(8, 0), (16, 0)]), ("disabled", [])])
def test_custom_pinch_clicks_once_on_release_and_does_not_drag(request, action, expected):
    controller, state = request.getfixturevalue("native")
    manager = GestureManager(controller, scrolling=False, click_action=action)
    points = list(RELAXED.landmarks)
    points[4] = Point(points[8].x + 0.01, points[8].y)
    pinched = replace(RELAXED, landmarks=tuple(points))
    manager.update(RELAXED, 0)
    for i in range(1, 40):
        manager.update(pinched, i * 0.04)
    assert state.events == []
    manager.update(RELAXED, 1.7)
    manager.update(RELAXED, 1.75)
    assert state.events == expected
    assert not controller._right_held


def test_right_click_partial_failure_releases_even_after_monitor_disconnect(request):
    controller, _state = request.getfixturevalue("native")
    controller.user32.SendInput.side_effect = None
    controller.user32.SendInput.return_value = 0
    with pytest.raises(OSError):
        controller.right_click()
    assert controller._right_held
    controller.user32.SendInput.return_value = 1
    controller.displays.ensure_current.side_effect = RuntimeError("disconnected")
    controller.release_all()
    assert not controller._right_held
    assert controller.user32.SendInput.call_count == 2


def test_runtime_pipeline_applies_all_preferences_and_preserves_local_coordinates(request):
    controller, state = request.getfixturevalue("native")
    settings = AirCursorConfig(smoothing=100, pointer_gain=0.5, pinch_threshold=0.4,
                              fist_start_hold_ms=4000, fist_pause_hold_ms=1000,
                              gesture_confirm_ms=400, v_action="disabled", bent_action="voice",
                              straight_action="scroll_down", cad_rotate=False, cad_zoom=False,
                              v_while_paused=True, bent_while_paused=True)
    settings.validate()
    _, gestures, controls, scroll, nav, smoother, gain, _ = control_pipeline(
        settings, FrameInputController(controller), controller)
    assert gestures.pinch.start_threshold == 0.4
    assert gestures.pinch.release_threshold == 0.5
    assert controls.voice_poses == (HandPose.BENT_HAND,)
    assert controls.paused_voice_poses == (HandPose.BENT_HAND,)
    assert scroll.paused_poses == (HandPose.V_SIGN, HandPose.BENT_HAND)
    assert controls.fist_start_hold == 4 and controls.fist_hold == 1
    assert controls.voice_confirm == scroll.confirm == 0.4
    assert scroll.bindings == {HandPose.STRAIGHT_HAND: -1}
    assert smoother.min_cutoff == 0.25 and smoother.beta == pytest.approx(0.003)
    assert gain.apply((0, 0)) == controller.cursor_position_local()
    assert gain.previous[0] == state.cursor[0] - controller.monitor.left
    assert not nav.rotate_enabled and not nav.zoom_enabled
    assert settings_view(settings)["smoothing"] == 100


def test_cad_switches_disable_rotation_and_zoom_independently():
    recorder = Recorder()
    nav = Navigation(recorder, rotate_enabled=False, zoom_enabled=False)
    assert not nav.update(RELAXED, 0, CONTEXT).blocks_mouse
    recorder.orbit = Mock()
    nav = Navigation(recorder, rotate_enabled=False, zoom_enabled=True)
    for i in range(20):
        from test_control_gestures import pose_hand

        nav.update(pose_hand((5,), rotate=i * 0.02), i * 0.04, CONTEXT)
    recorder.orbit.assert_not_called()
