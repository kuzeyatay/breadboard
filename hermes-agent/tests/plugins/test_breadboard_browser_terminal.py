"""Real callback transport preserves screenshots as native image tool results."""
import base64
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from types import SimpleNamespace

import plugins.breadboard as breadboard


def test_browser_tool_callback_delivers_pixels_and_current_page(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "browser-test-secret")
    received = []
    # Minimal JPEG marker bytes are enough to verify the byte-preserving transport.
    picture = b"\xff\xd8\xff\xe0browser-fixture\xff\xd9"
    data_url = "data:image/jpeg;base64," + base64.b64encode(picture).decode()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/api/hermes/tools/browser-terminal"
            assert self.headers["Authorization"] == "Bearer browser-test-secret"
            assert self.headers["X-Agent-Session-Id"] == "browser-test-session"
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append(body)
            page = {"title": "Current tab", "url": "https://example.com/", "text": "Page text", "selection": "Selected words"}
            if body["args"]["action"] == "screenshot":
                page["screenshot"] = {"dataUrl": data_url, "width": 640, "height": 480}
            payload = json.dumps({"ok": True, "data": page}).encode()
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
    tool = registered["browser_terminal"]
    try:
        read = json.loads(tool["handler"]({"action": "read"}, task_id="browser-test-session"))
        assert read["selection"] == "Selected words"
        capture = tool["handler"]({"action": "screenshot"}, task_id="browser-test-session")
        assert capture["_multimodal"] is True
        assert capture["content"][1]["image_url"]["url"] == data_url
        assert "Current tab" in capture["content"][0]["text"]
        assert data_url not in capture["text_summary"]
        image = Path(capture["meta"]["screenshot_path"])
        assert image.is_relative_to(tmp_path)
        assert image.read_bytes() == picture
        assert received[-1]["args"] == {"action": "screenshot"}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_invalid_capture_does_not_create_a_screenshot(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    result = json.loads(breadboard._browser_terminal_result({"screenshot": {"dataUrl": "https://example.com/picture"}}))
    assert "invalid screenshot" in result["error"]
    assert not list(tmp_path.rglob("*.jpg"))
