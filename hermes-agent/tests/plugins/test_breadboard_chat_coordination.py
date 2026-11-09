"""Cross-chat tools use the real plugin registration and authenticated HTTP path."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace

from agent.display import _detect_tool_failure
import plugins.breadboard as breadboard


def test_chat_tools_callback_and_failure(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "coordination-test-secret")
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/api/hermes/tools/chat-coordination"
            assert self.headers["Authorization"] == "Bearer coordination-test-secret"
            assert self.headers["X-Agent-Session-Id"] == "sender-session"
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(body)
            ok = body["args"].get("chat_id") != "foreign"
            result = {"ok": True, "data": {"status": "complete", "answer": "47 ohms"}} if ok else {
                "ok": False, "error": "Chat unavailable", "code": "chat_unavailable"}
            payload = json.dumps(result).encode()
            self.send_response(200 if ok else 404)
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
        for tool, args in [
            ("chat_list", {"query": "circuit"}),
            ("chat_send_message", {"chat_id": "conv_two", "message": "What resistor?", "request_id": "q1"}),
            ("chat_wait", {"message_id": "msg_1", "timeout_ms": 0}),
        ]:
            raw = registered[tool]["handler"](args, task_id="sender-session")
            result = json.loads(raw)
            assert _detect_tool_failure(tool, raw) == (False, "")
            assert result["answer"] == "47 ohms"
            assert requests[-1] == {"tool": tool, "args": args}
        result = json.loads(registered["chat_send_message"]["handler"](
            {"chat_id": "foreign", "message": "Hello", "request_id": "q2"}, task_id="sender-session"))
        assert result.get("error")
        assert "answer" not in result
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
