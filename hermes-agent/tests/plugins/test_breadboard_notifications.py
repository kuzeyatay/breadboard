"""On-demand notification reads use the authenticated plugin callback."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace

import plugins.breadboard as breadboard


def test_notification_callback_reads_fresh_notices(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "notifications-test-secret")
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/api/hermes/tools/notifications"
            assert self.headers["Authorization"] == "Bearer notifications-test-secret"
            assert self.headers["X-Agent-Session-Id"] == "voice-session"
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(body)
            result = {"scope": "undismissed", "notifications": [{
                "id": f"msg_{len(requests)}", "title": "Response ready",
                "source": "Research", "content": "The findings are ready.",
            }]}
            payload = json.dumps({"ok": True, "data": result}).encode()
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
    try:
        handler = registered["notifications_read"]["handler"]
        first = json.loads(handler({"limit": 1}, task_id="voice-session"))
        second = json.loads(handler({}, task_id="voice-session"))
        assert first["notifications"][0]["id"] == "msg_1"
        assert second["notifications"][0]["id"] == "msg_2"
        assert first["notifications"][0]["content"] == "The findings are ready."
        assert requests == [
            {"action": "notifications_read", "args": {"limit": 1}},
            {"action": "notifications_read", "args": {}},
        ]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
