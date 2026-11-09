import ctypes
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from test_control_gestures import FIST, V, pose_hand
from test_monitors import native  # noqa: F401 -- shared fake Windows fixture.
from test_scroll_navigation import BENT

from aircursor.input import InputEvent
from aircursor.interaction import FrameInputController


@pytest.fixture
def voice(request):
    controller, state = request.getfixturevalue("native")
    state.keys = []
    state.now = 1.0
    controller._clock = lambda: state.now

    def send(count, pointer, size):
        assert size == ctypes.sizeof(InputEvent)
        events = ctypes.cast(pointer, ctypes.POINTER(InputEvent))
        for i in range(count):
            event = events[i]
            if event.type == 1:
                state.keys.append((event.data.ki.wVk, event.data.ki.dwFlags,
                                   event.data.ki.dwExtraInfo))
            else:
                state.events.append((event.data.mi.dwFlags, event.data.mi.mouseData))
        return count

    controller.user32.SendInput.side_effect = send
    return controller, state


def test_held_chord_has_one_down_pair_and_tagged_reverse_release(voice):
    controller, state = voice
    for _ in range(50):
        controller.voice_down()
    marker = controller.VOICE_MARKER
    assert state.keys == [(0x11, 0, marker), (0x10, 0, marker)]
    # Breadboard neutralizes OS modifier state while dictating. Never resend downs.
    assert controller.user32.GetAsyncKeyState.call_count == 2
    controller.voice_up()
    controller.voice_up()
    assert state.keys[-2:] == [(0x10, 2, marker), (0x11, 2, marker)]
    assert len(state.keys) == 4


def test_modifier_already_held_physically_is_not_released(voice):
    controller, state = voice
    controller.user32.GetAsyncKeyState.side_effect = lambda key: 0x8000 if key == 0x11 else 0
    controller.voice_down()
    controller.voice_up()
    assert [(key, flags) for key, flags, _ in state.keys] == [(0x10, 0), (0x10, 2)]


def test_voice_release_is_allowed_after_monitor_disconnect(voice):
    controller, state = voice
    controller.voice_down()
    controller.displays.ensure_current.side_effect = RuntimeError("disconnected")
    controller.release_all()
    assert [flags for _, flags, _ in state.keys] == [0, 0, 2, 2]


def test_mouse_reset_does_not_cut_off_voice(voice):
    controller, state = voice
    controller.voice_down()
    FrameInputController(controller).release_all()
    assert len(state.keys) == 2
    controller.release_all()
    assert len(state.keys) == 4


def test_watchdog_lease_expires_and_can_be_refreshed_without_repressing(voice):
    controller, state = voice
    controller.voice_down()
    state.now = 1.45
    controller.voice_down()
    state.now = 1.60
    controller.expire_voice()
    assert len(state.keys) == 2
    state.now = 1.96
    controller.expire_voice()
    assert len(state.keys) == 4
    assert not controller._voice_active


def test_partial_down_failure_still_releases_every_owned_key(voice):
    controller, _state = voice
    controller.user32.SendInput.side_effect = None
    controller.user32.SendInput.return_value = 0
    with pytest.raises(OSError, match="voice key"):
        controller.voice_down()
    assert controller._voice_keys == [0x11]
    controller.user32.SendInput.return_value = 1
    controller.release_all()
    assert not controller._voice_keys


def test_failed_release_keeps_ownership_and_watchdog_retries(voice):
    controller, state = voice
    controller.voice_down()
    controller.user32.SendInput.side_effect = None
    controller.user32.SendInput.return_value = 0
    with pytest.raises(OSError, match="voice key"):
        controller.voice_up()
    assert controller._voice_keys == [0x11, 0x10]
    controller.user32.SendInput.return_value = 1
    state.now = 2.0
    controller.expire_voice()
    assert not controller._voice_keys


@pytest.mark.parametrize("finish", ["quit", "camera_failure", "display_disconnect", "scroll", "pinch", "cad", "arming", "embedded_stop", "embedded_pause", "embedded_reload"])
def test_application_routes_voice_and_fist_exclusively_and_cleans_up(voice, monkeypatch, finish):
    from aircursor import app
    from aircursor.app_context import AppContext
    from aircursor.config import AirCursorConfig

    controller, state = voice
    # Live app loop with recorded landmark poses and a fake Windows boundary;
    # no microphone, OS input, or camera is used by this regression test.
    relaxed = pose_hand((5,))
    hands = ([V] * 12 + [relaxed] * 6 + [FIST] * 24 + [V] * 12 +
             [relaxed] * 9 + [FIST] * 80 + [relaxed] * 9 + [V] * 12)
    activation_frame = 0
    failure = finish in {"camera_failure", "display_disconnect"}
    if finish.startswith("embedded"):
        hands = [V] * 14
    elif failure:
        hands = [V] * 12
    elif finish == "cad":
        # Enter automatically, orbit, then talk/pause/resume without a mode pose.
        hands = ([pose_hand((5,), rotate=i * 0.025) for i in range(12)] + hands)
    elif finish == "arming":
        # A ready CAD app, V, and a short fist cannot bypass paused startup.
        hands = [V] * 12 + [FIST] * 74 + [relaxed] * 5 + [FIST] * 80
        activation_frame = len(hands)
        hands += [pose_hand((5,), rotate=i * 0.025) for i in range(12)]
    elif finish == "scroll":
        from test_control_gestures import OPEN

        hands = [relaxed] * 5 + [BENT] * 20 + [relaxed] * 3 + [OPEN] * 20 + [relaxed] * 4
    elif finish == "pinch":
        from dataclasses import replace

        from test_control_gestures import OPEN

        from aircursor.models import Point

        points = list(relaxed.landmarks)
        points[4] = Point(points[8].x + 0.02, points[8].y)
        closed = replace(relaxed, landmarks=tuple(points))
        hands = [relaxed] * 5 + [closed] * 3 + [OPEN] * 8
    state.frame = -1
    movements = []

    def read_frame():
        state.frame += 1
        if finish == "arming" and state.frame <= activation_frame:
            assert not state.events and not state.keys and not movements
        state.now = 1.0 + state.frame * 0.04
        if state.frame == len(hands):
            return False, None
        return True, SimpleNamespace(shape=(480, 640, 3), hand=hands[state.frame])

    def move(x, y):
        state.cursor = (x, y)
        movements.append(hands[state.frame])
        return True

    if finish == "cad":
        original_send = controller.user32.SendInput.side_effect

        def send(count, pointer, size):
            events = ctypes.cast(pointer, ctypes.POINTER(InputEvent))
            if any(events[i].type == 1 and events[i].data.ki.dwFlags == 0 for i in range(count)):
                assert not controller._nav_buttons, "orbit must release before voice starts"
            return original_send(count, pointer, size)

        controller.user32.SendInput.side_effect = send

    def ensure(_target):
        if finish == "display_disconnect" and state.frame == len(hands) - 1:
            raise RuntimeError("display disconnected")

    controller.displays.list = lambda: [controller.monitor]
    controller.displays.ensure_current.side_effect = ensure
    controller.user32.SetCursorPos.side_effect = move
    capture = SimpleNamespace(read=read_frame, set=Mock(), isOpened=lambda: True, release=Mock())
    cv = SimpleNamespace(
        VideoCapture=lambda *_: capture, CAP_DSHOW=0, CAP_PROP_FRAME_WIDTH=0,
        CAP_PROP_FRAME_HEIGHT=0, CAP_PROP_BUFFERSIZE=0, WINDOW_NORMAL=0,
        WND_PROP_VISIBLE=0, FONT_HERSHEY_SIMPLEX=0, LINE_AA=0,
        namedWindow=Mock(), resizeWindow=Mock(), moveWindow=Mock(),
        rectangle=Mock(), putText=Mock(), circle=Mock(), imshow=Mock(),
        flip=lambda frame, _: frame, getWindowProperty=lambda *_: 1,
        destroyAllWindows=Mock(),
        waitKey=lambda _: ord("q") if not failure and state.frame == len(hands) - 1 else -1,
    )
    detector = SimpleNamespace(process=lambda frame: [frame.hand], close=Mock())
    watchdog = SimpleNamespace(start=Mock(), close=controller.voice_up)
    monkeypatch.setitem(sys.modules, "cv2", cv)
    monkeypatch.setattr(app, "WindowsDisplays", lambda: controller.displays)
    monkeypatch.setattr(app, "WindowsInputController", lambda *_: controller)
    context = (AppContext(100, "Breadboard.exe", "Breadboard CAD | Part", (-1920, 0, 0, 1080))
               if finish in {"cad", "arming"} else AppContext())
    monkeypatch.setattr(app, "WindowsAppContext", lambda: SimpleNamespace(read=lambda: context))
    monkeypatch.setattr(app, "MediaPipeHandDetector", lambda: detector)
    monkeypatch.setattr(app, "VoiceWatchdog", lambda _: watchdog)
    monkeypatch.setattr(app, "emergency_stop_pressed", lambda _: False)
    monkeypatch.setattr(app, "pause_chord_pressed", lambda _: False)
    monkeypatch.setattr(app.time, "monotonic", lambda: state.now)
    if finish.startswith("embedded"):
        def commands():
            if state.frame == len(hands) - 1:
                return ["stop"]
            if finish == "embedded_pause" and state.frame in {8, 10}:
                return ["pause"]
            if finish == "embedded_reload" and state.frame == 8:
                return ["reload-settings"]
            return []

        bridge = SimpleNamespace(commands=commands, publish=Mock(), set_settings=Mock(), settings_error=Mock())
        app.run(AirCursorConfig(start_paused=False), bridge=bridge, show_preview=False,
                reload_config=lambda: AirCursorConfig(pointer_gain=0.5, v_action="disabled", monitor="primary"))
        cv.namedWindow.assert_not_called()
        cv.imshow.assert_not_called()
        assert len(state.keys) == 4  # Both pause and stop release the held voice chord.
        assert bridge.publish.call_count == len(hands)
        assert bridge.publish.call_args.kwargs["paused"] == (finish in {"embedded_pause", "embedded_reload"})
        if finish == "embedded_reload":
            applied = bridge.set_settings.call_args.args[0]
            assert applied.pointer_gain == 0.5 and applied.monitor == "external"
            assert applied.start_paused
            bridge.settings_error.assert_not_called()
    elif finish == "quit":
        app.run(AirCursorConfig(start_paused=False))
        assert len(state.keys) == 8  # Two voice sessions; paused V never pressed anything.
        assert movements and all(hand == relaxed for hand in movements)
    elif failure:
        expected = "camera stopped" if finish == "camera_failure" else "display disconnected"
        with pytest.raises(RuntimeError, match=expected):
            app.run(AirCursorConfig(start_paused=False))
        assert len(state.keys) == 4
    elif finish == "scroll":
        app.run(AirCursorConfig(start_paused=False))
        wheels = [amount for flags, amount in state.events if flags == 0x800]
        assert any(amount > 0x7FFFFFFF for amount in wheels)  # Negative wheel data as DWORD.
        assert any(0 < amount < 0x7FFFFFFF for amount in wheels)
        assert all(flags == 0x800 for flags, _ in state.events)
        assert all(hand == relaxed for hand in movements)
        assert not state.keys
    elif finish == "cad":
        app.run(AirCursorConfig(start_paused=False))
        assert len(state.keys) == 8  # Voice still holds/releases; paused V is ignored.
        assert movements  # Rotation moved the pointer via an orbit drag.
        assert any(flags == 2 for flags, _ in state.events)
        assert not controller._nav_keys and not controller._nav_buttons
        assert sum(flags == 2 for flags, _ in state.events) == sum(flags == 4 for flags, _ in state.events)
    elif finish == "arming":
        app.run(AirCursorConfig())
        assert movements and any(flags == 2 for flags, _ in state.events)
        assert not state.keys
        assert not controller._nav_buttons and not controller._nav_keys
    else:
        app.run(AirCursorConfig(start_paused=False))
        assert sum(flags == 2 for flags, _ in state.events) == 1
        assert sum(flags == 4 for flags, _ in state.events) == 1
        assert not state.keys
    assert not controller._voice_keys
    assert not controller._voice_active
    if finish not in {"scroll", "pinch", "cad", "arming"}:
        assert state.events == []
    detector.close.assert_called_once()
    capture.release.assert_called_once()
