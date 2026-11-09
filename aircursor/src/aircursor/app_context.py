"""Read the foreground application's identity and client bounds for navigation."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AppContext:
    window: int = 0
    executable: str = ""
    title: str = ""
    bounds: tuple[int, int, int, int] = (0, 0, 0, 0)
    dialog: bool = False


class WindowsAppContext:
    def __init__(self):
        self.api = ctypes.WinDLL("user32", use_last_error=True)
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.GetForegroundWindow.restype = wintypes.HWND
        self.api.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        self.api.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        self.api.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        self.api.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        self.api.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.QueryFullProcessImageNameW.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)
        ]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self._pid = 0
        self._path = ""

    def read(self) -> AppContext:
        hwnd = self.api.GetForegroundWindow()
        if not hwnd:
            return AppContext()
        title, klass = ctypes.create_unicode_buffer(1024), ctypes.create_unicode_buffer(256)
        self.api.GetWindowTextW(hwnd, title, len(title))
        self.api.GetClassNameW(hwnd, klass, len(klass))
        pid = wintypes.DWORD()
        self.api.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value != self._pid:
            self._pid, self._path = pid.value, ""
            process = self.kernel.OpenProcess(0x1000, False, pid.value)
            if process:
                try:
                    path = ctypes.create_unicode_buffer(32768)
                    size = wintypes.DWORD(len(path))
                    if self.kernel.QueryFullProcessImageNameW(process, 0, path, ctypes.byref(size)):
                        self._path = path.value
                finally:
                    self.kernel.CloseHandle(process)
        rect, point = wintypes.RECT(), wintypes.POINT()
        if not self.api.GetClientRect(hwnd, ctypes.byref(rect)):
            return AppContext()
        if not self.api.ClientToScreen(hwnd, ctypes.byref(point)):
            return AppContext()
        return AppContext(hwnd, self._path, title.value,
                          (point.x, point.y, point.x + rect.right, point.y + rect.bottom),
                          klass.value == "#32770")
