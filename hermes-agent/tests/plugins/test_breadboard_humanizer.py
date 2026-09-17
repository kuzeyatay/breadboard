"""Humanizer calls survive the runtime startup and first-use rewrite budget."""

import json
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import plugins.breadboard as breadboard


def test_humanize_tools_reach_broker_with_cold_start_budget(monkeypatch):
    seen = []
    timeouts = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append((self.path, body))
            result = {"ok": True, "data": {"ready": True}} if body["tool"] == "humanize_status" else {
                "ok": True, "data": {"rewrittenText": "Plain prose.", "scores": {"delta": -10}},
            }
            payload = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    class ObservedConnection(HTTPConnection):
        def __init__(self, host, port, timeout):
            timeouts.append(timeout)
            super().__init__(host, port, timeout=timeout)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("BREADBOARD_INTERNAL_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    monkeypatch.setattr(breadboard, "HTTPConnection", ObservedConnection)
    try:
        for tool_name, args in [("humanize_status", {}), ("humanize_text", {"text": "Exact original prose."})]:
            name, route, kind, _schema = next(tool for tool in breadboard._TOOLS if tool[0] == tool_name)
            result = json.loads(breadboard._call_breadboard(
                args, tool_name=name, route=route, route_kind=kind,
                task_id="humanizer-test-session", tool_call_id="humanizer-test-call",
            ))
            assert "error" not in result, result
            if tool_name == "humanize_status":
                assert result["ready"] is True
            assert seen[-1] == ("/api/hermes/tools/humanizer", {"tool": tool_name, "args": args})
        assert result["rewrittenText"] == "Plain prose."
        assert all(timeout > 180 + 600 + 15 for timeout in timeouts)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
