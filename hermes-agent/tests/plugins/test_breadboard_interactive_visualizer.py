"""Interactive visualizer calls are pre-checked locally and given a build-length budget."""

import json
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import plugins.breadboard as breadboard


VALID_PLAN = {
    "schemaVersion": 1,
    "title": "Surface charge",
    "objective": "Show surface charge along a loop",
    "mode": "2d",
    "rationale": "Planar loop",
    "concepts": ["surface charge"],
    "assumptions": [],
    "controls": [{"id": "preset", "label": "Preset", "type": "select", "purpose": "pick"}],
    "outputs": [],
    "interactions": ["select a preset"],
    "dataRequirements": [],
    "assetRequirements": [],
    "accessibilityRequirements": [],
    "sourceReferences": [],
}

VALID_PACKAGE = {
    "schemaVersion": 2,
    "manifest": {
        "schemaVersion": 2,
        "artifactType": "interactive-visualizer",
        "title": "Surface charge",
        "description": "d",
        "accessibilityDescription": "a",
        "mode": "2d",
        "entry": "index.html",
        "runtime": {"id": "breadboard-interactive-visualizer", "version": "2.0.0"},
    },
    "assumptions": [],
    "limitations": [],
    "sourceReferences": [{"label": "ref"}],
    "semanticTests": [{"name": "layout", "assertion": "fits"}],
    "assets": [],
    "files": {"index.html": "<div></div>", "styles.css": "", "main.js": ""},
}


def _call(tool_name, args, **kwargs):
    name, route, kind, _schema = next(tool for tool in breadboard._TOOLS if tool[0] == tool_name)
    return json.loads(breadboard._call_breadboard(
        args, tool_name=name, route=route, route_kind=kind,
        task_id="visualizer-test-session", tool_call_id="visualizer-test-call", **kwargs,
    ))


def test_placeholder_arguments_are_rejected_before_any_request(monkeypatch):
    """A model that answers the nested schema with ``"files": 0`` gets the
    offending paths back instead of a sanitized 500 from the dashboard."""
    monkeypatch.setenv("BREADBOARD_INTERNAL_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")

    def refuse(*_args, **_kwargs):
        raise AssertionError("no HTTP request expected")

    monkeypatch.setattr(breadboard, "HTTPConnection", refuse)
    result = _call("interactive_visualizer_create", {
        "title": "Surface charge",
        "plan": {**VALID_PLAN, "controls": [0, 1, 2], "outputs": [0], "animation": 0},
        "package": {**VALID_PACKAGE, "manifest": 0, "files": 0, "semanticTests": [0, 1]},
    })
    assert result["status_code"] == 400
    for path in ("plan.controls[0]", "plan.animation", "package.manifest"):
        assert path in result["error"]
    assert "Nothing was created" in result["error"]

    # The anyOf package schema of generate/revise is inspected too.
    result = _call("interactive_visualizer_generate", {
        "artifactId": "art_1", "package": {**VALID_PACKAGE, "files": 0},
    })
    assert "package.files" in result["error"]

    # Missing required top-level fields are named as well.
    result = _call("interactive_visualizer_generate", {"artifactId": "art_1"})
    assert "package is required" in result["error"]


def test_publish_tools_use_a_build_length_socket_budget(monkeypatch):
    seen = []
    timeouts = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append(body.get("action") or body.get("tool"))
            payload = json.dumps({"ok": True, "data": {"artifact": {"id": "art_1"}}}).encode()
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
        assert "error" not in _call("interactive_visualizer_create", {
            "title": "Surface charge", "plan": VALID_PLAN, "package": VALID_PACKAGE,
        })
        assert "error" not in _call("interactive_visualizer_generate", {
            "artifactId": "art_1", "package": VALID_PACKAGE,
        })
        assert "error" not in _call("interactive_visualizer_plan", {
            "title": "Surface charge", "plan": VALID_PLAN,
        })
        assert seen == [
            "interactive_visualizer_create",
            "interactive_visualizer_generate",
            "interactive_visualizer_plan",
        ]
        # Three browser mounts plus a screenshot take over a minute; the batch
        # guard in tool_executor is 420 s, so stay below that.
        assert timeouts[0] == timeouts[1] >= 300
        assert timeouts[0] < 420
        assert timeouts[2] == breadboard._DEFAULT_REQUEST_TIMEOUT_SECONDS
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
