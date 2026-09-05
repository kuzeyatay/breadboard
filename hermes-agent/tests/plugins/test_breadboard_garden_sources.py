"""Source discovery and import use the normal capability-checked Garden broker."""

import json
from types import SimpleNamespace

import plugins.breadboard as breadboard


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
