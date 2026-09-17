"""Exercise the registered image tool over HTTP, including native/text fallback."""
import base64
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from types import SimpleNamespace

import pytest
import plugins.breadboard as breadboard


PIXELS = b"\xff\xd8\xff\xe0image-search-fixture\xff\xd9"
DATA_URL = "data:image/jpeg;base64," + base64.b64encode(PIXELS).decode()


def result(count=1):
    items = [{"title": f"Portrait {i}", "image": f"https://example.com/{i}.jpg",
              "thumb": f"https://example.com/{i}.jpg", "page": f"https://example.com/source/{i}",
              "site": "example.com"} for i in range(count)]
    return {"query": "Robert Downey Jr portrait", "itemsReturned": count,
            "display": {"query": "Robert Downey Jr portrait", "items": items},
            "screenshot": {"dataUrl": DATA_URL},
            "inspection": {"status": "awaiting_review", "loaded": count, "requested": count, "timedOut": False}}


@pytest.fixture
def transport(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "image-test-secret")
    state = {"response": result(), "requests": []}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/api/hermes/tools/image-search"
            assert self.headers["Authorization"] == "Bearer image-test-secret"
            assert self.headers["X-Agent-Session-Id"] == "image-session"
            state["requests"].append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            data = json.dumps({"ok": True, "data": state["response"]}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(breadboard, "_connection_target", lambda: server.server_address)
    registered = {}
    breadboard.register(SimpleNamespace(register_tool=lambda **tool: registered.update({tool["name"]: tool})))
    state["tool"] = registered["image_search"]
    state["call"] = lambda count=1: state["tool"]["handler"]({"query": "Robert Downey Jr portrait", "count": count}, task_id="image-session")
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.parametrize("count", range(1, 6))
def test_pixels_candidates_and_selected_count_survive_the_registered_transport(transport, tmp_path, count):
    transport["response"] = result(count)
    native = transport["call"](count)
    assert native["_multimodal"] is True
    assert native["content"][1]["image_url"]["url"] == DATA_URL
    data = json.loads(native["content"][0]["text"].split("\n", 1)[1])
    assert data["itemsReturned"] == len(data["display"]["items"]) == count
    assert data["inspection"]["status"] == "awaiting_review", "loading is not visual verification"
    cached = Path(native["meta"]["screenshot_path"])
    assert cached.is_relative_to(tmp_path)
    assert cached.read_bytes() == PIXELS
    assert transport["requests"][-1] == {"tool": "image_search", "args": {"query": "Robert Downey Jr portrait", "count": count}}
    fallback = json.loads(native["text_summary"])
    assert fallback["display"]["items"] == []
    assert fallback["itemsReturned"] == 0
    assert fallback["inspection"]["reason"] == "native_image_input_unavailable"
    assert "https://" not in native["text_summary"]
    assert DATA_URL not in native["text_summary"]


@pytest.mark.parametrize("screenshot", [None, {}, {"dataUrl": "https://example.com/preview.jpg"},
                                      {"dataUrl": "data:image/jpeg;base64,"},
                                      {"dataUrl": "data:image/jpeg;base64,not base64!"}])
def test_missing_or_invalid_pixels_do_not_release_candidate_links(transport, tmp_path, screenshot):
    transport["response"]["screenshot"] = screenshot
    failure = json.loads(transport["call"]())
    assert "error" in failure
    assert "https://example.com/0.jpg" not in json.dumps(failure)
    assert not list(tmp_path.rglob("*.jpg"))


def test_empty_search_stays_text_without_a_fake_screenshot(transport):
    transport["response"] = result(0)
    answer = json.loads(transport["call"]())
    assert answer["itemsReturned"] == 0
    assert "screenshot" not in answer


@pytest.mark.parametrize("bad", [{"itemsReturned": 3}, {"display": None}, {"display": {"items": "oops"}}])
def test_malformed_provider_shapes_are_rejected(transport, bad):
    transport["response"].update(bad)
    assert "error" in json.loads(transport["call"]())


def test_more_than_five_candidates_cannot_bypass_the_transport(transport):
    transport["response"] = result(6)
    assert "error" in json.loads(transport["call"]())
