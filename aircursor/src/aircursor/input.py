from __future__ import annotations

import ctypes
import threading
import time
from abc import ABC, abstractmethod
from ctypes import wintypes
from typing import ClassVar

from .monitors import Monitor, WindowsDisplays, select_monitor


class MouseInput(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG),
                ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


class KeyboardInput(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD),
                ("dwExtraInfo", ctypes.c_size_t)]


class HardwareInput(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD),
                ("wParamH", wintypes.WORD)]


class InputUnion(ctypes.Union):
    _fields_ = [("mi", MouseInput), ("ki", KeyboardInput), ("hi", HardwareInput)]


class InputEvent(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("data", InputUnion)]


class BaseInputController(ABC):
    @abstractmethod
    def screen_size(self) -> tuple[int, int]: ...

    @abstractmethod
    def move(self, x: int, y: int) -> None: ...

    @abstractmethod
    def click(self) -> None: ...

    @abstractmethod
    def left_down(self) -> None: ...

    @abstractmethod
    def left_up(self) -> None: ...

    @abstractmethod
    def scroll(self, amount: int) -> None: ...

    @abstractmethod
    def release_all(self) -> None: ...


class WindowsInputController(BaseInputController):
    LEFT_DOWN = 0x0002
    LEFT_UP = 0x0004
    WHEEL = 0x0800
    # Breadboard's native hook explicitly accepts Ctrl/Shift with this local marker.
    VOICE_MARKER = 0x4D415553
    CONTROL = 0x11
    SHIFT = 0x10
    NAV_MARKER = 0x41495243
    BUTTON_FLAGS: ClassVar = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010),
                             "middle": (0x0020, 0x0040)}

    def __init__(self, monitor: Monitor | None = None,
                 displays: WindowsDisplays | None = None) -> None:
        if not hasattr(ctypes, "windll"):
            raise OSError("WindowsInputController is available only on Windows")
        self.displays = displays or WindowsDisplays()
        self.monitor = monitor or select_monitor(self.displays.list(), "primary")
        self.user32 = self.displays.user32
        self.user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(InputEvent), ctypes.c_int)
        self.user32.SendInput.restype = wintypes.UINT
        self.user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
        self.user32.GetCursorPos.restype = wintypes.BOOL
        self.user32.GetForegroundWindow.restype = wintypes.HWND
        self.user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
        self.user32.MonitorFromWindow.restype = wintypes.HANDLE
        self._left_held = False
        self._right_held = False
        self._voice_keys: list[int] = []
        self._voice_active = False
        self._voice_deadline = 0.0
        self._voice_lock = threading.RLock()
        self._clock = time.monotonic
        self._nav_keys: list[int] = []
        self._nav_buttons: list[str] = []
        self._nav_window = 0
        self._nav_deadline = 0.0

    def _send_key(self, key: int, up: bool, marker: int = VOICE_MARKER) -> None:
        event = InputEvent(1, InputUnion(ki=KeyboardInput(
            key, 0, 0x0002 if up else 0, 0, marker
        )))
        if self.user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(InputEvent)) != 1:
            raise OSError("Windows rejected a voice key event")

    def voice_down(self) -> None:
        with self._voice_lock:
            self._voice_deadline = self._clock() + 0.50
            if self._voice_active:
                return
            self.ensure_target()
            # Do not take ownership of modifiers already held on the physical keyboard.
            for key in (self.CONTROL, self.SHIFT):
                if not self.user32.GetAsyncKeyState(key) & 0x8000:
                    self._voice_keys.append(key)
                    self._send_key(key, False)
            self._voice_active = True

    def voice_up(self) -> None:
        with self._voice_lock:
            error = None
            for key in self._voice_keys[::-1]:
                try:
                    self._send_key(key, True)
                    self._voice_keys.remove(key)
                except OSError as failed:
                    error = failed
            if error:
                raise error
            self._voice_active = False
            self._voice_deadline = 0.0

    def expire_voice(self) -> None:
        with self._voice_lock:
            if (self._voice_active or self._voice_keys) and self._clock() >= self._voice_deadline:
                self.voice_up()

    def _send(self, *flags: int, wheel: int = 0) -> None:
        events = (InputEvent * len(flags))(*(
            InputEvent(0, InputUnion(mi=MouseInput(0, 0, wheel & 0xFFFFFFFF, flag, 0, 0)))
            for flag in flags
        ))
        if self.user32.SendInput(len(events), events, ctypes.sizeof(InputEvent)) != len(events):
            raise OSError("Windows rejected mouse input. Stop control; use apps at the same privilege level.")

    def screen_size(self) -> tuple[int, int]:
        return self.monitor.size

    def ensure_target(self) -> None:
        self.displays.ensure_current(self.monitor)

    def _cursor_on_target(self) -> bool:
        self.ensure_target()
        point = wintypes.POINT()
        if not self.user32.GetCursorPos(ctypes.byref(point)):
            raise OSError("Windows could not read the cursor position")
        return self.monitor.contains(point.x, point.y)

    def move(self, x: int, y: int) -> None:
        self.ensure_target()
        if not self.user32.SetCursorPos(*self.monitor.to_desktop(x, y)):
            raise OSError("Windows rejected cursor movement")

    def double_click_time(self) -> float:
        return self.user32.GetDoubleClickTime() / 1000.0

    def cursor_position_local(self) -> tuple[int, int]:
        point = wintypes.POINT()
        if not self.user32.GetCursorPos(ctypes.byref(point)):
            raise OSError("Windows could not read the cursor position")
        width, height = self.monitor.size
        return (max(0, min(width - 1, point.x - self.monitor.left)),
                max(0, min(height - 1, point.y - self.monitor.top)))

    def click(self) -> None:
        if self._cursor_on_target():
            self._left_held = True  # Cleanup also covers a partially accepted SendInput batch.
            self._send(self.LEFT_DOWN, self.LEFT_UP)
            self._left_held = False

    def left_down(self) -> None:
        if not self._left_held and self._cursor_on_target():
            self._left_held = True
            self._send(self.LEFT_DOWN)

    def right_click(self) -> None:
        if self._cursor_on_target():
            self._right_held = True
            self._send(*self.BUTTON_FLAGS["right"])
            self._right_held = False

    def right_up(self) -> None:
        if self._right_held:
            self._send(self.BUTTON_FLAGS["right"][1])
            self._right_held = False

    def left_up(self) -> None:
        if self._left_held:
            self._send(self.LEFT_UP)
            self._left_held = False

    def scroll(self, amount: int) -> None:
        self.scroll_units(int(amount * 120))

    def scroll_units(self, units: int) -> None:
        if self._cursor_on_target():
            # Wheel delivery can follow focus instead of hover, depending on Windows/app
            # settings. Require focus on this monitor so it cannot scroll the laptop.
            foreground = self.user32.GetForegroundWindow()
            if (foreground and
                    self.user32.MonitorFromWindow(foreground, 0) == self.monitor.handle):
                self._send(self.WHEEL, wheel=units)

    def cursor_position(self) -> tuple[int, int]:
        point = wintypes.POINT()
        if not self.user32.GetCursorPos(ctypes.byref(point)):
            raise OSError("Windows could not read the cursor position")
        return point.x, point.y

    def navigation_allowed(self, window, bounds) -> bool:
        if self._voice_active or not window or self.user32.GetForegroundWindow() != window:
            return False
        if not self._cursor_on_target():
            return False
        x, y = self.cursor_position()
        left, top, right, bottom = bounds
        return (left + 12 <= x < right - 12 and top + 50 <= y < bottom - 12
                and self.user32.MonitorFromWindow(window, 0) == self.monitor.handle)

    def orbit(self, profile, window, bounds, dx, dy):
        with self._voice_lock:
            if not self.navigation_allowed(window, bounds):
                self.end_navigation()
                return
            if not dx and not dy:
                return
            if self._nav_window != window:
                self.end_navigation()
                self.release_mouse()
                self._nav_window = window
                # Navigation modifiers are untagged for Breadboard voice; only the
                # dedicated V gesture is allowed to start dictation.
                for key in profile.keys:
                    if not self.user32.GetAsyncKeyState(key) & 0x8000:
                        self._nav_keys.append(key)
                        self._send_key(key, False, self.NAV_MARKER)
                for button in profile.buttons:
                    self._nav_buttons.append(button)
                    self._send(self.BUTTON_FLAGS[button][0])
            self.refresh_navigation()
            x, y = self.cursor_position()
            left, top, right, bottom = bounds
            x = max(self.monitor.left, left + 12, min(self.monitor.right - 1, right - 13, x + dx))
            y = max(self.monitor.top, top + 50, min(self.monitor.bottom - 1, bottom - 13, y + dy))
            self.move(x - self.monitor.left, y - self.monitor.top)

    def refresh_navigation(self):
        with self._voice_lock:
            if self._nav_window:
                self._nav_deadline = self._clock() + 0.4

    def end_navigation(self):
        with self._voice_lock:
            error = None
            for button in self._nav_buttons[::-1]:
                try:
                    self._send(self.BUTTON_FLAGS[button][1])
                    self._nav_buttons.remove(button)
                except OSError as failed:
                    error = failed
            for key in self._nav_keys[::-1]:
                try:
                    self._send_key(key, True, self.NAV_MARKER)
                    self._nav_keys.remove(key)
                except OSError as failed:
                    error = failed
            if error:
                raise error
            self._nav_window = 0
            self._nav_deadline = 0.0

    def expire_navigation(self):
        with self._voice_lock:
            if self._nav_window and (self._clock() >= self._nav_deadline
                                     or self.user32.GetForegroundWindow() != self._nav_window):
                self.end_navigation()

    def release_mouse(self) -> None:
        # Always allow releasing our held button after disconnection or manual takeover.
        # Do not inject spurious button-up events while the user uses their physical mouse.
        try:
            self.left_up()
        finally:
            self.right_up()

    def release_all(self) -> None:
        try:
            self.release_mouse()
        finally:
            try:
                self.end_navigation()
            finally:
                self.voice_up()
