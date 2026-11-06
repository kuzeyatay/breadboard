"""Real callback transport preserves screenshots as native image tool results."""
import base64
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from types import SimpleNamespace
import pytest

import plugins.breadboard as breadboard


@pytest.mark.parametrize("tool_name, route, action, surface", [
    ("browser_terminal", "/api/hermes/tools/browser-terminal", "read", None),
    ("browser_terminal", "/api/hermes/tools/browser-terminal", "read", "app"),
    ("breadboard_use", "/api/hermes/tools/breadboard-use", "snapshot", None),
    ("attachment_image", "/api/hermes/tools/attachment-image", "read", None),
    ("garden_get_source_figure", "/api/hermes/tools/garden", "read", None),
    ("garden_get_source_figure", "/api/hermes/tools/garden", "pdf", None),
])
def test_browser_tool_callback_delivers_pixels_and_current_page(monkeypatch, tmp_path, tool_name, route, action, surface):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "browser-test-secret")
    received = []
    # Minimal JPEG marker bytes are enough to verify the byte-preserving transport.
    picture = b"\xff\xd8\xff\xe0browser-fixture\xff\xd9"
    data_url = "data:image/jpeg;base64," + base64.b64encode(picture).decode()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == route
            assert self.headers["Authorization"] == "Bearer browser-test-secret"
            assert self.headers["X-Agent-Session-Id"] == "browser-test-session"
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append(body)
            page = {"title": "Current tab", "url": "https://example.com/", "text": "Page text", "selection": "Selected words"}
            if body["args"].get("action") == "screenshot" or body["args"].get("imagePath") or body["args"].get("pdfPage"):
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
    tool = registered[tool_name]
    try:
        read = json.loads(tool["handler"]({"action": action}, task_id="browser-test-session"))
        assert read["selection"] == "Selected words"
        capture_args = ({"gardenId": "course", "slug": "sources/book", **({"pdfPage": 26} if action == "pdf" else {"imagePath": "/course/assets/map.png"})}
                        if tool_name == "garden_get_source_figure" else
                        {"action": "screenshot", **({"surface": surface} if surface else {})})
        capture = tool["handler"](capture_args, task_id="browser-test-session")
        assert capture["_multimodal"] is True
        assert capture["content"][1]["image_url"]["url"] == data_url
        assert "Current tab" in capture["content"][0]["text"]
        assert data_url not in capture["text_summary"]
        image = Path(capture["meta"]["screenshot_path"])
        assert image.is_relative_to(tmp_path)
        assert image.read_bytes() == picture
        assert received[-1]["args"] == capture_args
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_invalid_capture_does_not_create_a_screenshot(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    result = json.loads(breadboard._browser_terminal_result({"screenshot": {"dataUrl": "https://example.com/picture"}}))
    assert "invalid screenshot" in result["error"]
    assert not list(tmp_path.rglob("*.jpg"))


@pytest.mark.parametrize("tool_name", ["garden_get_page", "garden_get_source_excerpt", "document_skill_read"])
def test_source_read_callback_keeps_pagination_and_delivers_each_original_page(monkeypatch, tmp_path, tool_name):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "source-test-secret")
    numbers = list(range(1, 12)) if tool_name == "document_skill_read" else [1, 2]
    padding = b"p" * 220_000 if tool_name == "document_skill_read" else b""
    urls = ["data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xffpage" + bytes([page]) + padding + b"\xff\xd9").decode() for page in numbers]
    args = {"slug": "book", "file": "source/part-0001.md"} if tool_name == "document_skill_read" else {"slug": "sources/book", "offset": 0}
    page = {"content": "## Page 1\nFirst.\n## Page 2\nSecond.", "offset": 0, "nextOffset": 39, "totalChars": 80,
            "relPath": "sources/book.md", "sourcePages": [{"pdfPage": number, "sourcePdf": "/course/assets/book.pdf", "screenshot": {"dataUrl": url}} for number, url in enumerate(urls, 1)]}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == ("/api/hermes/tools/document-skill" if tool_name == "document_skill_read" else "/api/hermes/tools/garden")
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert body == {("action" if tool_name == "document_skill_read" else "tool"): tool_name, "args": args}
            payload = json.dumps({"ok": True, "data": page}).encode()
            self.send_response(200)
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
        result = registered[tool_name]["handler"](args, task_id="source-read-session")
        assert result["_multimodal"] is True
        assert [item["image_url"]["url"] for item in result["content"] if item["type"] == "image_url"] == urls
        text = json.loads(result["content"][0]["text"])
        assert text["content"] == page["content"]
        assert text["nextOffset"] == page["nextOffset"]
        assert result["meta"]["source_pages"] == numbers
        assert "unverified extracted text" in result["text_summary"]
        assert all(url not in result["text_summary"] for url in urls)
        assert len(list(tmp_path.rglob("*.jpg"))) == len(numbers)
        # Exercise the real UI completion boundary after the real HTTP callback.
        # Eleven scanned pages must not be copied into every SSE/recovery event.
        from tui_gateway import server as gateway
        events = []
        session = {"tool_progress_mode": "all"}
        monkeypatch.setitem(gateway._sessions, "source-read-session", session)
        monkeypatch.setattr(gateway, "_emit", lambda kind, sid, payload: events.append((kind, payload)))
        gateway._on_tool_complete("source-read-session", "source-read", tool_name, args, result)
        event = events[-1][1]
        assert events[-1][0] == "tool.complete"
        assert event["result"]["image_count"] == len(numbers)
        assert json.loads(event["result"]["content"][0]["text"])["content"] == page["content"]
        assert all(url not in json.dumps(event) for url in urls)
        assert all(url not in json.dumps(session["completed_tools"]) for url in urls)
        assert [item["image_url"]["url"] for item in result["content"] if item["type"] == "image_url"] == urls
        assert session["completed_tools"][0]["success"] is True
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
