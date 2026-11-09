"""Durable team actions reuse the registered authenticated launch tool."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace

import plugins.breadboard as breadboard


def test_team_actions_use_the_existing_launch_callback(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "swarm-test-secret")
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/api/hermes/tools/agent-launch"
            assert self.headers["Authorization"] == "Bearer swarm-test-secret"
            assert self.headers["X-Agent-Session-Id"] == "coordinator-session"
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            payload = json.dumps({"ok": True, "data": {"team_id": "swarm_test", "status": "verifying"}}).encode()
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
        tool = registered["agent_launch"]
        for args in [
            {"team_action": "catalog"},
            {"team_action": "status", "team_id": "swarm_test"},
            {"team_action": "verify", "team_id": "swarm_test", "task_key": "research",
             "checks": [{"criterion": "Traceable sources", "passed": True, "evidenceIds": ["evidence_test"]}]},
            {"team_action": "stop", "team_id": "swarm_test"},
        ]:
            result = json.loads(tool["handler"](args, task_id="coordinator-session"))
            assert result["team_id"] == "swarm_test"
            assert requests[-1] == {"action": "agent_launch", "args": args}
        assert "swarm_launch" not in registered
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
