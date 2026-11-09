"""Authenticated, loopback-only preview/control for Breadboard's gesture screen.

Frames live in memory and are encoded only while the screen is being viewed.
Input actions are consumed by the camera loop, never by HTTP worker threads.
"""
from __future__ import annotations

import base64
import hmac
import json
import os
import queue
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .config import AirCursorConfig, settings_view


class BreadboardBridge:
    def __init__(self, descriptor: Path):
        self.descriptor = descriptor
        self.token = secrets.token_hex(32)
        self._lock = threading.Lock()
        self._commands: queue.Queue[str] = queue.Queue(maxsize=16)
        self._last_view = -10.0
        self._last_frame = -10.0
        self._state = {"phase": "initializing", "paused": True, "status": "Camera off",
                       "detail": "Hold a fist for 3 seconds to enable control.",
                       "display": "External monitor", "image": None}
        bridge = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def _authorized(self):
                return (not self.headers.get("Origin") and hmac.compare_digest(
                    self.headers.get("Authorization", ""), f"Bearer {bridge.token}"))

            def _reply(self, code, data):
                body = json.dumps(data).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def do_GET(self):
                if not self._authorized():
                    self._reply(403, {"error": "Forbidden"})
                elif self.path != "/snapshot":
                    self._reply(404, {"error": "Not found"})
                else:
                    with bridge._lock:
                        bridge._last_view = time.monotonic()
                        state = dict(bridge._state)
                    self._reply(200, state)

            def do_POST(self):
                if not self._authorized():
                    self._reply(403, {"error": "Forbidden"})
                    return
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if self.path != "/command" or not 0 < size <= 128:
                        raise ValueError
                    body = json.loads(self.rfile.read(size))
                    if (not isinstance(body, dict) or not isinstance(body.get("action"), str)
                            or body.get("action") not in {
                        "pause", "stop", "embed", "reload-settings"
                    }):
                        raise ValueError
                    bridge._commands.put_nowait(body["action"])
                except (ValueError, queue.Full):
                    self._reply(400, {"error": "Invalid command"})
                    return
                self._reply(200, {"ok": True})

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def __enter__(self):
        self.descriptor.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.descriptor.with_suffix(".tmp")
        temporary.write_text(json.dumps({"version": 1, "pid": os.getpid(), "token": self.token,
                                        "port": self._server.server_port}), encoding="utf-8")
        temporary.replace(self.descriptor)
        self._thread.start()
        return self

    def __exit__(self, *_args):
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=1)
        try:
            if json.loads(self.descriptor.read_text("utf-8")).get("token") == self.token:
                self.descriptor.unlink()
        except (OSError, ValueError):
            pass
        with self._lock:
            self._state["image"] = None

    def commands(self) -> list[str]:
        result = []
        while True:
            try:
                result.append(self._commands.get_nowait())
            except queue.Empty:
                return result

    def publish(self, frame, *, paused: bool, status: str, detail: str, display: str):
        now = time.monotonic()
        with self._lock:
            viewed = now - self._last_view < 2
            self._state.update(phase="running", paused=paused, status=status,
                               detail=detail, display=display)
            if not viewed:
                self._state["image"] = None
        if viewed and now - self._last_frame >= 0.1:
            import cv2

            ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if ok:
                with self._lock:
                    self._state["image"] = base64.b64encode(jpeg).decode("ascii")
                self._last_frame = now

    def fail(self, error: str):
        with self._lock:
            self._state.update(phase="error", paused=True, status=error, image=None)

    def set_settings(self, config: AirCursorConfig):
        with self._lock:
            self._state.update(settings=settings_view(config), settingsRevision=config.settings_revision,
                               settingsError=None)

    def settings_error(self, error: str):
        with self._lock:
            self._state.update(settingsError=error, paused=True)
