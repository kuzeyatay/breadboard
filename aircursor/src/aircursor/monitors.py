"""Physical-pixel display selection; never fall back to another display."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Monitor:
    name: str
    device_id: str
    label: str
    left: int
    top: int
    right: int
    bottom: int
    primary: bool = False
    handle: int = field(default=0, compare=False)

    @property
    def size(self) -> tuple[int, int]:
        return self.right - self.left, self.bottom - self.top

    def contains(self, x: int, y: int) -> bool:
        return self.left <= x < self.right and self.top <= y < self.bottom

    def to_desktop(self, x: int, y: int) -> tuple[int, int]:
        width, height = self.size
        return (self.left + max(0, min(width - 1, int(x))),
                self.top + max(0, min(height - 1, int(y))))


def select_monitor(monitors: list[Monitor], selector: str,
                   device_id: str | None = None) -> Monitor:
    if selector == "external":
        candidates = [monitor for monitor in monitors if not monitor.primary]
    elif selector == "primary":
        candidates = [monitor for monitor in monitors if monitor.primary]
    else:
        candidates = [monitor for monitor in monitors
                      if monitor.name.casefold() == selector.casefold()]
    if device_id:
        candidates = [monitor for monitor in candidates if monitor.device_id == device_id]
    if len(candidates) != 1:
        raise RuntimeError(
            f"Target monitor {selector!r} is missing or ambiguous. "
            "Connect the selected display or use --list-monitors to select it. "
            "AirCursor will not control a different display."
        )
    return candidates[0]


class MonitorInfo(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD),
                ("szDevice", wintypes.WCHAR * 32)]


class DisplayDevice(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("DeviceName", wintypes.WCHAR * 32),
                ("DeviceString", wintypes.WCHAR * 128), ("StateFlags", wintypes.DWORD),
                ("DeviceID", wintypes.WCHAR * 128), ("DeviceKey", wintypes.WCHAR * 128)]


class WindowsDisplays:
    def __init__(self) -> None:
        if not hasattr(ctypes, "WinDLL"):
            raise OSError("AirCursor display selection requires Windows")
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        # Keep coordinates in physical pixels even with mixed monitor scaling.
        try:
            self.user32.SetProcessDpiAwarenessContext.argtypes = [wintypes.HANDLE]
            self.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        except AttributeError:
            self.user32.SetProcessDPIAware()
        self.user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MonitorInfo)]
        self.user32.GetMonitorInfoW.restype = wintypes.BOOL
        self.user32.EnumDisplayDevicesW.argtypes = [
            wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(DisplayDevice), wintypes.DWORD
        ]
        self.user32.EnumDisplayDevicesW.restype = wintypes.BOOL

    def get(self, handle: int) -> Monitor:
        info = MonitorInfo()
        info.cbSize = ctypes.sizeof(info)
        if not self.user32.GetMonitorInfoW(handle, ctypes.byref(info)):
            raise RuntimeError("The selected display disconnected. AirCursor has stopped.")
        device = DisplayDevice()
        device.cb = ctypes.sizeof(device)
        if not self.user32.EnumDisplayDevicesW(info.szDevice, 0, ctypes.byref(device), 1):
            raise RuntimeError("Cannot identify the selected display. AirCursor has stopped.")
        rect = info.rcMonitor
        return Monitor(info.szDevice, device.DeviceID, device.DeviceString,
                       rect.left, rect.top, rect.right, rect.bottom,
                       bool(info.dwFlags & 1), handle)

    def list(self) -> list[Monitor]:
        callback_type = ctypes.WINFUNCTYPE(
            wintypes.BOOL, wintypes.HANDLE, wintypes.HDC,
            ctypes.POINTER(wintypes.RECT), wintypes.LPARAM
        )
        handles: list[int] = []

        @callback_type
        def collect(handle, _dc, _rect, _data):
            handles.append(handle)
            return True

        self.user32.EnumDisplayMonitors.argtypes = [
            wintypes.HDC, ctypes.POINTER(wintypes.RECT), callback_type, wintypes.LPARAM
        ]
        self.user32.EnumDisplayMonitors.restype = wintypes.BOOL
        if not self.user32.EnumDisplayMonitors(None, None, collect, 0):
            raise OSError("Windows could not enumerate displays")
        return [self.get(handle) for handle in handles]

    def ensure_current(self, target: Monitor) -> None:
        if self.get(target.handle) != target:
            raise RuntimeError(
                "The selected display or its layout changed. AirCursor has stopped; "
                "restart it after reconnecting your external monitor."
            )
