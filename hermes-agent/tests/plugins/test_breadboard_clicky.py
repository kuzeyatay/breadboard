"""Hermes exposes the native Clicky action and preserves real callback outcomes."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace

import plugins.breadboard as breadboard


def test_clicky_launch_callback_preserves_success_and_failure(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "clicky-test-secret")
    received = []
    outcomes = [
        {"performed": True, "launch": {"ok": True, "code": "launched", "message": "Clicky opened."}},
        {"performed": False, "launch": {"ok": False, "code": "unsupported", "message": "Clicky is available on Windows and macOS."}},
    ]

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/api/hermes/tools/breadboard-use"
            assert self.headers["Authorization"] == "Bearer clicky-test-secret"
            assert self.headers["X-Agent-Session-Id"] == "clicky-session"
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append(body)
            payload = json.dumps({"ok": True, "data": outcomes[len(received) - 1]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(breadboard, "_connection_target", lambda: server.server_address)
    registered = {}
    breadboard.register(SimpleNamespace(register_tool=lambda **tool: registered.update({tool["name"]: tool})))
    tool = registered["breadboard_use"]
    try:
        assert "launch_clicky" in tool["schema"]["parameters"]["properties"]["action"]["enum"]
        for expected in outcomes:
            result = json.loads(tool["handler"]({"action": "launch_clicky"}, task_id="clicky-session"))
            assert result == expected
        assert all(body["args"] == {"action": "launch_clicky"} for body in received)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
