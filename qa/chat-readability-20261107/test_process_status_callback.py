"""Exercise the registered status tool through its real HTTP callback."""
import json
import os
from pathlib import Path
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace

os.environ["HERMES_HOME"] = tempfile.mkdtemp(prefix="breadboard-status-plugin-")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "hermes-agent"))
import plugins.breadboard as breadboard


def test_active_filter_survives_registered_callback(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "status-test-secret")
    requests = []
    result = {"processes": [{"title": "This chat", "detail": {"isCurrentConversation": True}}], "truncated": False}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/api/hermes/tools/process-status"
            assert self.headers["Authorization"] == "Bearer status-test-secret"
            assert self.headers["X-Agent-Session-Id"] == "status-session"
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
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
        tool = registered["breadboard_process_status"]
        properties = tool["schema"]["parameters"]["properties"]
        assert properties["active_only"]["type"] == "boolean"
        for args in ({"kinds": ["chat_turn"], "active_only": True}, {"kinds": ["chat_turn"]}):
            assert set(args).issubset(properties)
            assert json.loads(tool["handler"](args, task_id="status-session")) == result
        assert requests == [
            {"tool": "breadboard_process_status", "args": {"kinds": ["chat_turn"], "active_only": True}},
            {"tool": "breadboard_process_status", "args": {"kinds": ["chat_turn"]}},
        ]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
