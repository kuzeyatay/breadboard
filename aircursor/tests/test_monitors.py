import ctypes
from ctypes import wintypes
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from aircursor.input import InputEvent, WindowsInputController
from aircursor.monitors import Monitor, WindowsDisplays, select_monitor
from aircursor.pointer import CoordinateMapper

LAPTOP = Monitor(r"\\.\DISPLAY1", "laptop-id", "Laptop", 0, 0, 1920, 1200, True, 1)
EXTERNAL = Monitor(r"\\.\DISPLAY2", "acer-id", "Acer", -1920, 0, 0, 1080, False, 2)
VIRTUAL = Monitor(r"\\.\DISPLAY6", "virtual-id", "Virtual", 1920, 0, 3840, 1080, False, 6)


@pytest.mark.parametrize("camera_point,desktop_point", [
    ((-1, -1), (-1920, 0)),
    ((0.5, 0.5), (-960, 540)),
    ((2, 2), (-1, 1079)),
])
def test_camera_mapping_covers_only_the_external_monitor(camera_point, desktop_point):
    mapper = CoordinateMapper(*EXTERNAL.size)
    assert EXTERNAL.to_desktop(*mapper.map(*camera_point)) == desktop_point
    assert EXTERNAL.contains(*desktop_point)
    assert not LAPTOP.contains(*desktop_point)


@pytest.mark.parametrize("target", [
    EXTERNAL,
    replace(EXTERNAL, left=0, top=-1080, right=1920, bottom=0),
    replace(EXTERNAL, left=1920, top=200, right=4480, bottom=1640),
])
def test_clamping_handles_negative_coordinates_and_other_layouts(target):
    for x, y in ((-9999, -9999), (0, 0), (100, 200), (9999, 9999)):
        assert target.contains(*target.to_desktop(x, y))


def test_selection_never_guesses_between_physical_and_virtual_displays():
    monitors = [LAPTOP, EXTERNAL, VIRTUAL]
    with pytest.raises(RuntimeError, match="ambiguous"):
        select_monitor(monitors, "external")
    assert select_monitor(monitors, EXTERNAL.name, "acer-id") == EXTERNAL


@pytest.mark.parametrize("monitors", [
    [LAPTOP],
    [LAPTOP, replace(VIRTUAL, name=EXTERNAL.name)],
])
def test_missing_or_replaced_display_does_not_fall_back(monitors):
    with pytest.raises(RuntimeError, match="will not control a different display"):
        select_monitor(monitors, EXTERNAL.name, "acer-id")


@pytest.mark.parametrize("changed", [
    replace(EXTERNAL, left=0, right=1920),
    replace(EXTERNAL, bottom=1440),
    replace(EXTERNAL, device_id="replacement-id"),
])
def test_live_monitor_changes_stop_control(changed):
    displays = WindowsDisplays.__new__(WindowsDisplays)
    displays.get = Mock(return_value=changed)
    with pytest.raises(RuntimeError, match="layout changed"):
        displays.ensure_current(EXTERNAL)


@pytest.fixture
def native(monkeypatch):
    # Exercise the production input controller without moving/clicking the real desktop.
    monkeypatch.setattr(ctypes, "windll", object(), raising=False)
    state = SimpleNamespace(cursor=(-960, 540), focused_monitor=2, events=[], keys=[])

    def get_cursor(pointer):
        point = ctypes.cast(pointer, ctypes.POINTER(wintypes.POINT)).contents
        point.x, point.y = state.cursor
        return True

    def set_cursor(x, y):
        state.cursor = (x, y)
        return True

    def send_input(count, events, _size):
        events = ctypes.cast(events, ctypes.POINTER(InputEvent))
        for i in range(count):
            if events[i].type == 0:
                state.events.append((events[i].data.mi.dwFlags, events[i].data.mi.mouseData))
            else:
                state.keys.append((events[i].data.ki.wVk, events[i].data.ki.dwFlags,
                                   events[i].data.ki.dwExtraInfo))
        return count

    api = SimpleNamespace(
        SendInput=Mock(side_effect=send_input),
        GetCursorPos=Mock(side_effect=get_cursor),
        SetCursorPos=Mock(side_effect=set_cursor),
        GetForegroundWindow=Mock(return_value=100),
        MonitorFromWindow=Mock(side_effect=lambda *_: state.focused_monitor),
        GetAsyncKeyState=Mock(return_value=0),
        GetDoubleClickTime=Mock(return_value=500),
    )
    displays = SimpleNamespace(user32=api, ensure_current=Mock())
    return WindowsInputController(EXTERNAL, displays), state


def test_native_move_applies_origin_and_clamps_after_smoothing(native):
    controller, state = native
    assert controller.screen_size() == (1920, 1080)
    controller.move(-100, 9000)
    assert state.cursor == (-1920, 1079)
    controller.move(9000, -100)
    assert state.cursor == (-1, 0)


@pytest.mark.parametrize("cursor", [(0, 100), (1920, 100), (-960, -1)])
def test_click_drag_and_scroll_are_suppressed_outside_target(native, cursor):
    controller, state = native
    state.cursor = cursor
    controller.click()
    controller.left_down()
    controller.scroll(1)
    assert state.events == []


def test_click_drag_and_wheel_work_on_target(native):
    controller, state = native
    controller.click()
    controller.left_down()
    controller.left_up()
    controller.scroll(-1)
    assert state.events == [(2, 0), (4, 0), (2, 0), (4, 0), (0x800, (-120 & 0xFFFFFFFF))]


def test_scroll_cannot_go_to_an_app_focused_on_the_laptop(native):
    controller, state = native
    state.focused_monitor = 1
    controller.scroll(1)
    assert state.events == []


def test_disconnect_blocks_new_actions_but_releases_an_owned_drag(native):
    controller, state = native
    controller.left_down()
    controller.displays.ensure_current.side_effect = RuntimeError("Disconnected")
    for action in (lambda: controller.move(0, 0), controller.click,
                   lambda: controller.scroll(1)):
        with pytest.raises(RuntimeError, match="Disconnected"):
            action()
    controller.release_all()
    assert state.events == [(2, 0), (4, 0)]


def test_idle_cleanup_does_not_release_a_physical_mouse_drag(native):
    controller, state = native
    controller.release_all()
    controller.release_all()
    assert state.events == []


def test_partial_click_failure_is_released_during_cleanup(native):
    controller, _state = native
    controller.user32.SendInput.side_effect = None
    controller.user32.SendInput.return_value = 1
    with pytest.raises(OSError, match="rejected mouse input"):
        controller.click()
    controller.release_all()
    assert not controller._left_held
    assert controller.user32.SendInput.call_args.args[1][0].data.mi.dwFlags == 4
