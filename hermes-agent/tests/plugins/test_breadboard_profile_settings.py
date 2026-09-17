"""Profile switch arguments and observed state survive the registered tool callback."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace

import plugins.breadboard as breadboard


def test_profile_controls_round_trip(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "profile-test-secret")
    received = []
    cases = [
        ({"action": "open", "surface": "profile"}, {"performed": True}),
        ({"action": "snapshot", "targetId": 8, "offset": 300},
         {"snapshotId": "snapshot", "elements": [{"ref": "e301", "name": "Clap controls", "checked": False}], "nextOffset": None}),
        ({"action": "set_checked", "targetId": 8, "snapshotId": "snapshot", "ref": "e301", "checked": True},
         {"performed": True, "changed": True, "requestedChecked": True}),
        ({"action": "set_checked", "targetId": 8, "snapshotId": "snapshot2", "ref": "e301", "checked": False},
         {"performed": True, "changed": False, "requestedChecked": False}),
    ]

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/api/hermes/tools/breadboard-use"
            assert self.headers["Authorization"] == "Bearer profile-test-secret"
            assert self.headers["X-Agent-Session-Id"] == "profile-session"
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append(body["args"])
            payload = json.dumps({"ok": True, "data": cases[len(received) - 1][1]}).encode()
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
        properties = tool["schema"]["parameters"]["properties"]
        for args, expected in cases:
            assert set(args).issubset(properties)
            assert args["action"] in properties["action"]["enum"]
            if "surface" in args:
                assert args["surface"] in properties["surface"]["enum"]
            result = json.loads(tool["handler"](args, task_id="profile-session"))
            assert result == expected
        assert properties["checked"]["type"] == "boolean"
        assert received == [args for args, _ in cases]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
