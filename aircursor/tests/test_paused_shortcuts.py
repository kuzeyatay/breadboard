"""Exercise the real frame router: selected shortcuts never unlock other OS input."""
import sys
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from test_control_gestures import OPEN, V, pose_hand
from test_monitors import native  # noqa: F401 -- dependency of the native voice fixture
from test_scroll_navigation import BENT, RELAXED
from test_voice_input import voice  # noqa: F401 -- records native keyboard and mouse events

from aircursor import app
from aircursor.app_context import AppContext
from aircursor.config import AirCursorConfig
from aircursor.models import Point


@pytest.mark.parametrize("preferences,voice_sessions,directions", [
    ({}, 0, set()),
    ({"v_while_paused": True}, 2, set()),
    ({"v_while_paused": True, "v_action": "scroll_down"}, 0, {-1}),
    ({"bent_while_paused": True, "bent_action": "voice"}, 1, set()),
    ({"bent_while_paused": True, "straight_while_paused": True}, 0, {-1, 1}),
    ({"v_while_paused": True, "v_action": "disabled"}, 0, set()),
    ({"v_while_paused": True, "v_action": "scroll_up", "bent_while_paused": True,
      "straight_while_paused": True, "scroll_enabled": False}, 0, set()),
])
def test_paused_shortcuts_cannot_move_click_drag_or_enter_cad(request, monkeypatch,
                                                          preferences, voice_sessions, directions):
    controller, state = request.getfixturevalue("voice")
    points = list(RELAXED.landmarks)
    points[4] = Point(points[8].x + 0.01, points[8].y)
    pinched = replace(RELAXED, landmarks=tuple(points))
    hands = ([V] * 16 + [None] * 8 + [V] * 16 + [RELAXED] * 8 + [pinched] * 22
             + [RELAXED] * 8 + [BENT] * 20 + [OPEN] * 20
             + [pose_hand((5,), rotate=i * 0.03) for i in range(15)])
    bridge, _cv = run_recording(monkeypatch, controller, state, hands, AirCursorConfig(**preferences))
    assert len(state.keys) == voice_sessions * 4
    assert all(flags == 0x800 for flags, _ in state.events), "Only explicit wheel gestures may send mouse input"
    wheel_signs = {-1 if amount > 0x7fffffff else 1 for _, amount in state.events}
    assert wheel_signs == directions
    controller.user32.SetCursorPos.assert_not_called()
    assert all(call.kwargs["paused"] for call in bridge.publish.call_args_list)
    assert not controller._voice_keys and not controller._nav_buttons and not controller._nav_keys


@pytest.mark.parametrize("finish", ["stop", "camera_failure", "reload"])
def test_paused_voice_releases_on_stop_failure_or_switch_off(request, monkeypatch, finish):
    controller, state = request.getfixturevalue("voice")
    config = AirCursorConfig(v_while_paused=True)
    bridge, cv = run_recording(monkeypatch, controller, state, [V] * 30, config, finish)
    assert len(state.keys) == 4  # Exactly one down pair and one up pair.
    assert not state.events and not controller._voice_keys
    controller.user32.SetCursorPos.assert_not_called()
    if finish == "reload":
        assert not bridge.set_settings.call_args.args[0].v_while_paused
    # Embedded status lives outside the image, so the larger 88% frame stays visible.
    cv.putText.assert_not_called()
    assert all(call.args[1:3] == ((38, 28), (601, 451)) for call in cv.rectangle.call_args_list)


def run_recording(monkeypatch, controller, state, hands, config, finish="stop"):
    state.frame = -1

    def read_frame():
        state.frame += 1
        state.now = 1 + state.frame * 0.04
        if state.frame == len(hands):
            return False, None
        return True, SimpleNamespace(shape=(480, 640, 3), hand=hands[state.frame])

    capture = SimpleNamespace(read=read_frame, set=Mock(), isOpened=lambda: True, release=Mock())
    cv = SimpleNamespace(VideoCapture=lambda *_: capture, CAP_DSHOW=0, CAP_PROP_FRAME_WIDTH=0,
                         CAP_PROP_FRAME_HEIGHT=0, CAP_PROP_BUFFERSIZE=0, rectangle=Mock(),
                         circle=Mock(), putText=Mock(), flip=lambda frame, _: frame,
                         destroyAllWindows=Mock())
    detector = SimpleNamespace(process=lambda frame: [] if frame.hand is None else [frame.hand], close=Mock())
    controller.displays.list = lambda: [controller.monitor]
    monkeypatch.setitem(sys.modules, "cv2", cv)
    monkeypatch.setattr(app, "WindowsDisplays", lambda: controller.displays)
    monkeypatch.setattr(app, "WindowsInputController", lambda *_: controller)
    context = AppContext(100, "Breadboard.exe", "Breadboard CAD | Part", (-1920, 0, 0, 1080))
    monkeypatch.setattr(app, "WindowsAppContext", lambda: SimpleNamespace(read=lambda: context))
    monkeypatch.setattr(app, "MediaPipeHandDetector", lambda: detector)
    monkeypatch.setattr(app, "VoiceWatchdog", lambda _: SimpleNamespace(start=Mock(), close=controller.voice_up))
    monkeypatch.setattr(app, "emergency_stop_pressed", lambda _: False)
    monkeypatch.setattr(app, "pause_chord_pressed", lambda _: False)
    monkeypatch.setattr(app.time, "monotonic", lambda: state.now)

    def commands():
        if state.frame == len(hands) - 1 and finish != "camera_failure":
            return ["stop"]
        if finish == "reload" and state.frame == 14:
            return ["reload-settings"]
        return []

    bridge = SimpleNamespace(commands=commands, publish=Mock(), set_settings=Mock(), settings_error=Mock())
    if finish == "camera_failure":
        with pytest.raises(RuntimeError, match="camera stopped"):
            app.run(config, bridge=bridge, show_preview=False)
    else:
        app.run(config, bridge=bridge, show_preview=False,
                reload_config=lambda: replace(config, v_while_paused=False))
    bridge.settings_error.assert_not_called()
    detector.close.assert_called_once()
    capture.release.assert_called_once()
    return bridge, cv
