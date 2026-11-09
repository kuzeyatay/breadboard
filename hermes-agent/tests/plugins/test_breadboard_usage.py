"""Usage reads travel through the authenticated Breadboard plugin callback."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace

import plugins.breadboard as breadboard


def test_usage_callback_reads_the_meter_without_credentials_in_arguments(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "usage-test-secret")
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/api/hermes/tools/usage"
            assert self.headers["Authorization"] == "Bearer usage-test-secret"
            assert self.headers["X-Agent-Session-Id"] == "usage-session"
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            payload = json.dumps({"ok": True, "data": {
                "available": True, "refreshed": True, "source": "report",
                "windows": [{"used_percent": 26, "remaining_percent": 74}],
                "reserve": {"active": True},
            }}).encode()
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
        tool = registered["breadboard_usage"]
        assert tool["toolset"] == "breadboard"
        assert tool["schema"]["parameters"]["properties"] == {}
        assert tool["schema"]["parameters"]["additionalProperties"] is False
        result = json.loads(tool["handler"]({}, task_id="usage-session"))
        assert result["available"] is True
        assert result["refreshed"] is True
        assert result["windows"][0]["remaining_percent"] == 74
        assert result["reserve"]["active"] is True
        assert requests == [{"action": "breadboard_usage", "args": {}}]
        assert "usage-test-secret" not in json.dumps(result)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
