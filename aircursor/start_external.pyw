"""Desktop launcher for the locally configured external-monitor trial."""
import ctypes
import json
import os
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
log = (ROOT / "aircursor.log").open("w", encoding="utf-8", buffering=1)
sys.stdout = log
sys.stderr = log


def main():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    mutex = kernel.CreateMutexW(None, False, "Local\\AirCursorExternalMonitor")
    if not mutex:
        raise ctypes.WinError(ctypes.get_last_error())
    embedded = "--embedded" in sys.argv
    try:
        if ctypes.get_last_error() == 183:
            if not embedded:
                ctypes.windll.user32.MessageBoxW(None, "AirCursor is already running.", "AirCursor", 0)
            return
        from aircursor.app import run
        from aircursor.breadboard_bridge import BreadboardBridge
        from aircursor.config import AirCursorConfig

        def load_config():
            return AirCursorConfig(**json.loads((ROOT / "settings.json").read_text("utf-8")))

        config = load_config()
        with BreadboardBridge(ROOT / ".install-tmp" / "breadboard-controller.json") as bridge:
            try:
                # A new session always requires a deliberate fist hold, including embedded use.
                config.start_paused = True
                run(config, bridge=bridge, show_preview=not embedded, reload_config=load_config)
            except Exception as error:
                bridge.fail(str(error))
                time.sleep(2)  # Give the embedded screen time to receive the failure.
                raise
    finally:
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel.CloseHandle(mutex)


try:
    main()
except Exception as error:  # noqa: BLE001 -- show all startup/runtime failures in this GUI launcher.
    traceback.print_exc()
    if "--embedded" not in sys.argv:
        ctypes.windll.user32.MessageBoxW(
            None, f"{error}\n\nDetails: {ROOT / 'aircursor.log'}", "AirCursor stopped", 0x10
        )
    sys.exit(1)
