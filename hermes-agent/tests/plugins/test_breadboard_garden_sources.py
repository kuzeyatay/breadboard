"""Source discovery and import use the normal capability-checked Garden broker."""

import json
from types import SimpleNamespace

import plugins.breadboard as breadboard
from plugins.breadboard.garden_revision_reads import GardenRevisionReads


def test_cross_garden_search_forwards_scope_and_citations(monkeypatch):
    registered = {}
    breadboard.register(SimpleNamespace(register_tool=lambda **tool: registered.update({tool["name"]: tool})))
    requests = []
    chunks = [{"gardenId": "other-garden", "relPath": "sources/guide.md", "content": "Source evidence."}]
    figures = [{"gardenId": "other-garden", "relPath": "sources/guide.md", "markdown": "![Diagram](</other-garden/assets/diagram.png>)"}]

    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, method, route, *, body, headers):
            assert route == "/api/hermes/tools/garden"
            requests.append(json.loads(body))

        def getresponse(self):
            return SimpleNamespace(status=200, read=lambda limit: json.dumps({
                "ok": True, "data": {"chunks": chunks, "figures": figures},
            }).encode())

        def close(self):
            pass

    monkeypatch.setattr(breadboard, "HTTPConnection", Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    for name, field, expected in [("garden_search", "chunks", chunks), ("garden_get_source_figure", "figures", figures)]:
        tool = registered[name]
        parameters = tool["schema"]["parameters"]
        assert "scope" not in parameters.get("required", [])
        assert "all" in parameters["properties"]["scope"]["enum"]
        if name == "garden_get_source_figure":
            assert "slug" not in parameters.get("required", [])
        for selector in [{"scope": "all"}, {"gardenId": "other-garden"}, {}]:
            args = {"query": "resonance", **selector}
            result = json.loads(tool["handler"](args, task_id="cross-garden-session"))
            assert requests[-1] == {"tool": name, "args": args}
            assert result[field] == expected
    for name in ["garden_get_page", "garden_get_source_excerpt", "garden_get_page_context", "garden_get_graph_neighbors"]:
        assert "slug" in registered[name]["schema"]["parameters"]["required"]


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


def test_generated_lesson_context_and_repair_result_survive_the_broker(monkeypatch):
    registered = {}
    breadboard.register(SimpleNamespace(register_tool=lambda **tool: registered.update({tool["name"]: tool})))
    requests, timeouts = [], []

    class Connection:
        def __init__(self, host, port, timeout):
            timeouts.append(timeout)

        def request(self, method, route, *, body, headers):
            requests.append(json.loads(body))

        def getresponse(self):
            return SimpleNamespace(status=200, read=lambda limit: json.dumps({
                "ok": False, "error": "Teaching gaps remain",
                "data": {"repairedDraft": "A retained draft", "repairCount": 3,
                         "problems": [{"code": "unverified-prerequisite"}]},
            }).encode())

        def close(self):
            pass

    monkeypatch.setattr(breadboard, "HTTPConnection", Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    lesson = {"learningQuestion": "How does a function work?", "newConcepts": ["function"],
              "assumedBackground": ["arithmetic"], "taughtLater": ["cylindrical coordinates"],
              "previousLessonSlugs": [], "sourcePassages": [{"pageSlug": "sources/book", "offset": 25, "limit": 4000}]}
    args = {"title": "Algebra", "content": "Draft", "minimumProseWords": 1400, "lesson": lesson}
    result = json.loads(registered["garden_save_note"]["handler"](args, task_id="lesson-session"))
    assert requests[-1]["args"] == args
    assert result["error"] == "Teaching gaps remain"
    assert result["data"]["repairedDraft"] == "A retained draft"
    assert timeouts[-1] >= 30 * 60
    # Invalid length arguments are handled by the server, not by a Python
    # comparison exception before the authenticated request is made.
    registered["garden_save_note"]["handler"]({"title": "Note", "content": "Text", "minimumProseWords": "bad"}, task_id="lesson-session")
    assert requests[-1]["args"]["minimumProseWords"] == "bad"
    for name, args in [
        ("garden_save_note", {"title": "Lesson", "content": "Draft"}),
        ("garden_create_note_proposal", {"title": "Lesson", "content": "Draft", "rationale": "Teach"}),
        ("garden_propose_page_revision", {"pageSlug": "notes/lesson", "originalText": "Old", "patchOrReplacement": "Draft", "rationale": "Teach"}),
    ]:
        result = json.loads(registered[name]["handler"](args, task_id="lesson-session"))
        assert requests[-1] == {"tool": name, "args": args}
        assert timeouts[-1] >= 30 * 60
        assert result["data"]["repairedDraft"] == "A retained draft"


def test_complete_read_receipt_submits_exact_old_body_to_normal_review_broker(monkeypatch):
    registered = {}
    breadboard.register(SimpleNamespace(register_tool=lambda **tool: registered.update({tool["name"]: tool})))
    requests = []
    original = "# Lesson\n\n$$\nv\n=\nx+y\n$$"

    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, method, route, *, body, headers):
            assert route == "/api/hermes/tools/garden"
            requests.append(json.loads(body))

        def getresponse(self):
            if requests[-1]["tool"] == "garden_get_page":
                data = {"content": original, "offset": 0, "totalChars": len(original)}
                return SimpleNamespace(status=200, read=lambda limit: json.dumps({"ok": True, "data": data}).encode())
            # A concurrent canonical change must still be rejected by the server.
            return SimpleNamespace(status=409, read=lambda limit: b'{"error":"The original passage no longer matches"}')

        def close(self):
            pass

    monkeypatch.setattr(breadboard, "HTTPConnection", Connection)
    monkeypatch.setattr(breadboard, "garden_revision_reads", GardenRevisionReads())
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    result = json.loads(registered["garden_get_page"]["handler"]({"gardenId": "em1", "slug": "notes/lesson.md", "offset": 0}, task_id="s"))
    revised = json.loads(registered["garden_propose_page_revision"]["handler"]({"gardenId": "em1", "pageSlug": "notes/lesson.md", "originalBodyReadId": result["revisionBodyReadId"], "patchOrReplacement": "New body", "rationale": "Regenerate"}, task_id="s"))
    assert requests[-1]["args"]["originalText"] == original
    assert requests[-1]["args"]["patchOrReplacement"] == "New body"
    assert "originalBodyReadId" not in requests[-1]["args"]
    assert "no longer matches" in revised["error"]
    previous_requests = len(requests)
    denied = json.loads(registered["garden_propose_page_revision"]["handler"]({"pageSlug": "other", "originalBodyReadId": result["revisionBodyReadId"], "patchOrReplacement": "New body", "rationale": "Regenerate"}, task_id="s"))
    assert denied["error"]
    assert len(requests) == previous_requests
