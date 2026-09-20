"""Source discovery and import use the normal capability-checked Garden broker."""

import json
from types import SimpleNamespace

import plugins.breadboard as breadboard


def test_garden_read_pagination_and_missing_page_alternatives(monkeypatch):
    registered = {}
    breadboard.register(SimpleNamespace(register_tool=lambda **tool: registered.update({tool["name"]: tool})))
    requests = []

    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, method, route, *, body, headers):
            requests.append(json.loads(body))

        def getresponse(self):
            return SimpleNamespace(status=200, read=lambda limit: b'{"ok":false,"error":"Page not found","data":{"availableMatches":[{"relPath":"sources/current.md"}]}}')

        def close(self):
            pass

    monkeypatch.setattr(breadboard, "HTTPConnection", Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    for name, args in [
        ("garden_get_page", {"slug": "old", "query": "attendance", "offset": 4000, "limit": 4000}),
        ("garden_get_source_excerpt", {"slug": "old", "query": "attendance"}),
        ("garden_list_files", {"query": "guide", "folder": "sources", "offset": 50, "limit": 50}),
    ]:
        result = json.loads(registered[name]["handler"](args, task_id="read-session"))
        assert requests[-1] == {"tool": name, "args": args}
        assert result["availableMatches"] == [{"relPath": "sources/current.md"}]


def test_source_tools_register_and_forward_the_exact_source(monkeypatch):
    registered = {}
    breadboard.register(SimpleNamespace(register_tool=lambda **tool: registered.update({tool["name"]: tool})))
    assert {"garden_discover_sources", "garden_import_source"} <= registered.keys()
    requests = []

    class Connection:
        def __init__(self, host, port, timeout):
            assert timeout >= 90  # A source download must outlive its server budget.

        def request(self, method, route, *, body, headers):
            requests.append(json.loads(body))
            assert method == "POST"
            assert route == "/api/hermes/tools/garden"
            assert headers["X-Agent-Runtime"] == "hermes"

        def getresponse(self):
            return SimpleNamespace(status=200, read=lambda limit: json.dumps({
                "ok": True, "data": {"status": "queued", "jobId": "source-job", "processing": True},
            }).encode())

        def close(self):
            pass

    monkeypatch.setattr(breadboard, "HTTPConnection", Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    args = {"gardenId": "circuits", "kind": "pdf", "url": "https://example.com/circuits.pdf", "title": "Circuits"}
    result = json.loads(registered["garden_import_source"]["handler"](args, task_id="source-session"))
    assert requests == [{"tool": "garden_import_source", "args": args}]
    assert result["processing"] is True
    assert result["status"] == "queued"
    assert result["jobId"] == "source-job"

    # Attachments are a valid alternative to a URL, including batch selection
    # by position when two uploaded files share a name.
    schema = registered["garden_import_source"]["schema"]
    assert "url" not in schema["parameters"].get("required", [])
    for selector in [{"attachmentName": "lecture.pdf"}, {"attachmentIndex": 2}]:
        args = {"gardenId": "circuits", **selector}
        result = json.loads(registered["garden_import_source"]["handler"](args, task_id="source-session"))
        assert requests[-1] == {"tool": "garden_import_source", "args": args}
        assert result["processing"] is True

    # The browser owns the sign-in. The model forwards only a source link and
    # parser preferences; the broker resolves the linked session server-side.
    args = {
        "gardenId": "circuits", "url": "https://canvas.example/courses/42/files/7/download",
        "useBrowserSession": True, "parseWithAnydoc": True, "parseWithVlm": True,
    }
    for name in ("useBrowserSession", "parseWithAnydoc", "parseWithVlm"):
        assert schema["parameters"]["properties"][name]["type"] == "boolean"
    result = json.loads(registered["garden_import_source"]["handler"](args, task_id="source-session"))
    assert requests[-1] == {"tool": "garden_import_source", "args": args}
    assert result["processing"] is True


def test_import_scope_denial_is_not_reported_as_a_success(monkeypatch):
    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            return SimpleNamespace(status=200, read=lambda limit: b'{"ok":false,"error":"Garden outside authorized scope"}')

        def close(self):
            pass

    monkeypatch.setattr(breadboard, "HTTPConnection", Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    result = json.loads(breadboard._call_breadboard(
        {"kind": "audio", "url": "https://example.com/audio.mp3"},
        tool_name="garden_import_source", route="/api/hermes/tools/garden",
        route_kind="garden", task_id="source-session",
    ))
    assert "authorized scope" in result["error"]
