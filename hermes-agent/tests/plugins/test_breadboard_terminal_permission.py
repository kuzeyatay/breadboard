"""Breadboard terminal commands escalate a server 428 into Hermes approval."""

import json
from pathlib import Path

import plugins.breadboard as breadboard
import tools.approval as approval


class _Response:
    def __init__(self, status: int, data: dict):
        self.status = status
        self._raw = json.dumps(data).encode("utf-8")

    def read(self, _limit: int) -> bytes:
        return self._raw


class _Connection:
    bodies = []
    timeouts = []

    def __init__(self, _host: str, _port: int, timeout: int):
        self.timeout = timeout
        self.timeouts.append(timeout)
        self.body = b""

    def request(self, _method: str, _route: str, *, body: bytes, headers: dict):
        self.body = body
        self.bodies.append(json.loads(body))
        assert headers["X-Agent-Runtime"] == "hermes"

    def getresponse(self):
        payload = json.loads(self.body)
        if payload.get("permissionGranted") is True:
            return _Response(200, {"ok": True, "data": {"stdout": "1G"}})
        return _Response(
            428,
            {
                "code": "terminal_permission_required",
                "error": "Outside the automatic policy.",
            },
        )

    def close(self):
        return None


class _NonJsonNotFoundConnection(_Connection):
    def getresponse(self):
        response = _Response(404, {})
        response._raw = b"<!doctype html><title>Not Found</title>"
        return response


def test_terminal_permission_card_retries_the_exact_approved_command(monkeypatch):
    _Connection.bodies = []
    _Connection.timeouts = []
    monkeypatch.setattr(breadboard, "HTTPConnection", _Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    seen = {}

    def approve(tool_name, reason, **kwargs):
        seen.update(tool_name=tool_name, reason=reason, kwargs=kwargs)
        return {"approved": True, "message": None}

    monkeypatch.setattr(approval, "request_tool_approval", approve)
    result = breadboard._call_breadboard(
        {"command": "du -sh ."},
        tool_name="terminal_execute_command",
        route="/api/hermes/tools/terminal",
        route_kind="terminal",
        task_id="session-1",
        tool_call_id="call-1",
    )

    assert seen["tool_name"] == "terminal_execute_command"
    assert seen["kwargs"]["display_target"] == "du -sh ."
    assert [body.get("permissionGranted", False) for body in _Connection.bodies] == [
        False,
        True,
    ]
    assert _Connection.timeouts == [135, 135]
    assert "1G" in result


def test_denied_terminal_permission_does_not_retry(monkeypatch):
    _Connection.bodies = []
    _Connection.timeouts = []
    monkeypatch.setattr(breadboard, "HTTPConnection", _Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    monkeypatch.setattr(
        approval,
        "request_tool_approval",
        lambda *args, **kwargs: {"approved": False, "message": "Denied by user."},
    )

    result = breadboard._call_breadboard(
        {"command": "du -sh ."},
        tool_name="terminal_execute_command",
        route="/api/hermes/tools/terminal",
        route_kind="terminal",
        task_id="session-1",
    )

    assert len(_Connection.bodies) == 1
    assert _Connection.timeouts == [135]
    assert "Denied by user" in result


class _SlowScanConnection(_Connection):
    """A command that outlives its slice: still running, then finished."""

    collections = []

    def getresponse(self):
        payload = json.loads(self.body)
        command_id = payload.get("commandId")
        if command_id is None:
            return _Response(
                200,
                {
                    "ok": True,
                    "data": {
                        "running": True,
                        "commandId": "scan-1",
                        "stdout": "",
                        "exitCode": None,
                        "timedOut": False,
                    },
                },
            )
        self.collections.append(command_id)
        if len(self.collections) < 2:
            return _Response(
                200,
                {
                    "ok": True,
                    "data": {
                        "running": True,
                        "commandId": "scan-1",
                        "stdout": "",
                        "exitCode": None,
                        "timedOut": False,
                    },
                },
            )
        return _Response(
            200,
            {
                "ok": True,
                "data": {
                    "running": False,
                    "commandId": None,
                    "stdout": "48.2 GB  C:\\pagefile.sys",
                    "exitCode": 0,
                    "timedOut": False,
                    "elapsedMs": 412_000,
                },
            },
        )


def test_a_command_that_outlives_its_slice_is_collected_not_abandoned(monkeypatch):
    _SlowScanConnection.bodies = []
    _SlowScanConnection.timeouts = []
    _SlowScanConnection.collections = []
    monkeypatch.setattr(breadboard, "HTTPConnection", _SlowScanConnection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")

    result = breadboard._call_breadboard(
        {"command": "Get-ChildItem C:\\ -File -Recurse"},
        tool_name="terminal_execute_command",
        route="/api/hermes/tools/terminal",
        route_kind="terminal",
        task_id="session-1",
        tool_call_id="call-1",
    )

    assert _SlowScanConnection.collections == ["scan-1", "scan-1"]
    collected = json.loads(result)
    assert collected["running"] is False
    assert collected["exitCode"] == 0
    assert "pagefile.sys" in collected["stdout"]
    assert _SlowScanConnection.timeouts == [135, 135, 135]


def test_collection_stops_at_the_budget_and_reports_partial_output(monkeypatch):
    _SlowScanConnection.bodies = []
    _SlowScanConnection.timeouts = []
    _SlowScanConnection.collections = []
    monkeypatch.setattr(breadboard, "HTTPConnection", _SlowScanConnection)
    monkeypatch.setattr(breadboard, "_TERMINAL_COLLECT_BUDGET_SECONDS", 0)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")

    result = breadboard._call_breadboard(
        {"command": "Get-ChildItem C:\\ -File -Recurse"},
        tool_name="terminal_execute_command",
        route="/api/hermes/tools/terminal",
        route_kind="terminal",
        task_id="session-1",
    )

    assert _SlowScanConnection.collections == []
    abandoned = json.loads(result)
    assert abandoned["running"] is False
    assert abandoned["timedOut"] is True
    assert "stopped waiting" in abandoned["note"]


class _McpConnection(_Connection):
    def getresponse(self):
        payload = json.loads(self.body)
        if payload.get("permissionGranted") is True:
            return _Response(
                200,
                {
                    "ok": True,
                    "data": {
                        "connection": "gmail",
                        "action": "gmail_send_message",
                    },
                },
            )
        return _Response(
            428,
            {
                "code": "connected_app_permission_required",
                "error": "Sending this email changes data in Gmail.",
            },
        )


def test_connected_app_write_retries_only_after_hermes_approval(monkeypatch):
    _McpConnection.bodies = []
    _McpConnection.timeouts = []
    monkeypatch.setattr(breadboard, "HTTPConnection", _McpConnection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    seen = {}

    def approve(tool_name, reason, **kwargs):
        seen.update(tool_name=tool_name, reason=reason, kwargs=kwargs)
        return {"approved": True, "message": None}

    monkeypatch.setattr(approval, "request_tool_approval", approve)
    result = breadboard._call_breadboard(
        {
            "connection": "nango",
            "tool": "gmail_send_message",
            "args": {
                "to": ["reader@example.com"],
                "subject": "Hello",
                "body": "Hi",
            },
        },
        tool_name="mcp_call",
        route="/api/hermes/tools/mcp",
        route_kind="mcp",
        task_id="session-1",
        tool_call_id="call-1",
    )

    assert seen["tool_name"] == "mcp_call"
    assert seen["kwargs"]["display_target"] == "nango:gmail_send_message"
    assert [
        body.get("permissionGranted", False) for body in _McpConnection.bodies
    ] == [False, True]
    assert "gmail_send_message" in result


def test_non_terminal_tools_keep_the_short_request_deadline(monkeypatch):
    _Connection.bodies = []
    _Connection.timeouts = []
    monkeypatch.setattr(breadboard, "HTTPConnection", _Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")

    breadboard._call_breadboard(
        {},
        tool_name="garden_list",
        route="/api/hermes/tools/garden",
        route_kind="garden",
        task_id="session-1",
    )

    assert _Connection.timeouts == [45]


def test_non_json_404_identifies_a_dashboard_runtime_version_mismatch(monkeypatch):
    _NonJsonNotFoundConnection.bodies = []
    _NonJsonNotFoundConnection.timeouts = []
    monkeypatch.setattr(breadboard, "HTTPConnection", _NonJsonNotFoundConnection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")

    result = breadboard._call_breadboard(
        {
            "connection": "connected-apps",
            "tool": "gmail_list_messages",
            "args": {"maxResults": 1},
        },
        tool_name="mcp_call",
        route="/api/hermes/tools/mcp",
        route_kind="mcp",
        task_id="session-1",
    )

    assert "HTTP 404" in result
    assert "Restart Breadboard" in result
    assert "same version" in result


def test_interactive_visualizer_tools_are_registered_with_structured_schemas():
    registered = {}

    class _Context:
        def register_tool(self, **kwargs):
            registered[kwargs["name"]] = kwargs

    breadboard.register(_Context())

    expected = {
        "interactive_visualizer_plan",
        "interactive_visualizer_generate",
        "interactive_visualizer_revise",
        "interactive_visualizer_rollback",
        "interactive_visualizer_cancel",
    }
    assert expected.issubset(registered)
    plan = registered["interactive_visualizer_plan"]["schema"]["parameters"]
    assert plan["required"] == ["title", "plan"]
    assert plan["properties"]["plan"]["properties"]["mode"]["enum"] == [
        "2d",
        "3d",
        "hybrid",
    ]
    package = registered["interactive_visualizer_generate"]["schema"][
        "parameters"
    ]["properties"]["package"]
    variants = package["anyOf"]
    assert [variant["properties"]["schemaVersion"]["const"] for variant in variants] == [
        1,
        2,
    ]
    assert all(variant["properties"]["assets"]["maxItems"] == 0 for variant in variants)
    assert variants[0]["properties"]["files"]["required"] == [
        "index.html",
        "styles.css",
        "main.ts",
    ]
    assert variants[1]["properties"]["files"]["required"] == [
        "index.html",
        "styles.css",
        "main.js",
    ]


def test_artifact_search_is_registered_with_a_bounded_scoped_query(monkeypatch):
    registered = {}

    class _Context:
        def register_tool(self, **kwargs):
            registered[kwargs["name"]] = kwargs

    breadboard.register(_Context())

    parameters = registered["artifact_search"]["schema"]["parameters"]
    assert parameters["required"] == ["query"]
    assert parameters["properties"]["limit"] == {
        "type": "integer",
        "minimum": 1,
        "maximum": 50,
    }
    assert parameters["properties"]["includeContent"] == {"type": "boolean"}
    assert parameters["properties"]["contentOffset"] == {
        "type": "integer",
        "minimum": 0,
        "maximum": 100000,
    }
    args = {
        "query": "quarterly forecast",
        "limit": 5,
        "includeContent": True,
        "contentOffset": 25,
    }
    assert breadboard._request_payload(
        route_kind="artifact",
        tool_name="artifact_search",
        args=args,
        tool_call_id="call-artifact-search",
    ) == {
        "action": "artifact_search",
        "args": args,
        "toolCallId": "call-artifact-search",
    }

    _Connection.bodies = []
    _Connection.timeouts = []
    monkeypatch.setattr(breadboard, "HTTPConnection", _Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    breadboard._call_breadboard(
        args,
        tool_name="artifact_search",
        route="/api/hermes/tools/artifacts",
        route_kind="artifact",
        task_id="session-1",
        tool_call_id="call-artifact-search",
    )
    assert _Connection.timeouts == [200]


def test_premortem_tool_is_registered_with_bounded_argv_and_callback_payload():
    registered = {}

    class _Context:
        def register_tool(self, **kwargs):
            registered[kwargs["name"]] = kwargs

    breadboard.register(_Context())

    parameters = registered["premortem_run"]["schema"]["parameters"]
    assert parameters["required"] == ["arguments"]
    arguments = parameters["properties"]["arguments"]
    assert arguments["minItems"] == 1
    assert arguments["maxItems"] == 40
    assert arguments["items"]["maxLength"] == 8192
    assert breadboard._request_payload(
        route_kind="premortem",
        tool_name="premortem_run",
        args={"arguments": ["workflow", "next"]},
        tool_call_id="call-1",
    ) == {
        "action": "premortem_run",
        "args": {"arguments": ["workflow", "next"]},
    }


def test_patent_disclosure_guidance_is_registered_as_a_bounded_read_only_tool():
    registered = {}

    class _Context:
        def register_tool(self, **kwargs):
            registered[kwargs["name"]] = kwargs

    breadboard.register(_Context())

    tool = registered["patent_disclosure_guide"]
    parameters = tool["schema"]["parameters"]
    assert parameters["required"] == []
    assert parameters["additionalProperties"] is False
    assert parameters["properties"]["path"]["maxLength"] == 240
    assert "read-only" in tool["schema"]["description"]
    assert breadboard._request_payload(
        route_kind="patent_disclosure",
        tool_name="patent_disclosure_guide",
        args={"path": "prompts/disclosure/intake.md"},
        tool_call_id="call-patent-guide",
    ) == {
        "action": "patent_disclosure_guide",
        "args": {"path": "prompts/disclosure/intake.md"},
    }


def test_watch_tool_is_registered_with_bounded_video_options():
    registered = {}

    class _Context:
        def register_tool(self, **kwargs):
            registered[kwargs["name"]] = kwargs

    breadboard.register(_Context())

    parameters = registered["watch_run"]["schema"]["parameters"]
    assert parameters["required"] == ["source", "question"]
    assert parameters["properties"]["detail"]["enum"] == [
        "transcript",
        "efficient",
        "balanced",
        "token-burner",
    ]
    assert parameters["properties"]["maxFrames"]["maximum"] == 250
    assert parameters["properties"]["fps"]["maximum"] == 2
    assert breadboard._request_payload(
        route_kind="watch",
        tool_name="watch_run",
        args={
            "source": "https://example.com/video.mp4",
            "question": "Summarize it",
            "detail": "efficient",
        },
        tool_call_id="call-2",
    ) == {
        "action": "watch_run",
        "args": {
            "source": "https://example.com/video.mp4",
            "question": "Summarize it",
            "detail": "efficient",
        },
    }


def test_manim_tool_is_registered_with_artifact_identity_and_render_timeout(monkeypatch):
    registered = {}

    class _Context:
        def register_tool(self, **kwargs):
            registered[kwargs["name"]] = kwargs

    breadboard.register(_Context())

    parameters = registered["manim_create"]["schema"]["parameters"]
    assert parameters["required"] == ["title", "description", "code"]
    assert parameters["properties"]["quality"]["enum"] == [
        "draft",
        "standard",
        "high",
    ]
    assert parameters["properties"]["code"]["maxLength"] == 65536
    args = {
        "title": "Completing the square",
        "description": "An equation is rewritten as a perfect square.",
        "code": "from manim import *\nclass BreadboardScene(Scene):\n    pass",
        "sceneName": "BreadboardScene",
        "quality": "standard",
    }
    assert breadboard._request_payload(
        route_kind="manim",
        tool_name="manim_create",
        args=args,
        tool_call_id="call-manim",
    ) == {
        "action": "manim_create",
        "args": args,
        "toolCallId": "call-manim",
    }

    _Connection.bodies = []
    _Connection.timeouts = []
    monkeypatch.setattr(breadboard, "HTTPConnection", _Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    breadboard._call_breadboard(
        args,
        tool_name="manim_create",
        route="/api/hermes/tools/manim",
        route_kind="manim",
        task_id="session-1",
        tool_call_id="call-manim",
    )
    assert _Connection.timeouts == [320]
    assert _Connection.bodies == [
        {"action": "manim_create", "args": args, "toolCallId": "call-manim"}
    ]


def test_spotify_play_exposes_phone_playback_controls():
    registered = {}

    class _Context:
        def register_tool(self, **kwargs):
            registered[kwargs["name"]] = kwargs

    breadboard.register(_Context())

    parameters = registered["spotify_play"]["schema"]["parameters"]
    assert parameters["required"] == []
    assert parameters["properties"]["action"]["enum"] == [
        "pause",
        "resume",
        "next",
        "previous",
        "seek",
        "shuffle",
        "volume",
        "repeat",
    ]
    assert parameters["properties"]["volumePercent"]["minimum"] == 0
    assert parameters["properties"]["volumePercent"]["maximum"] == 100


def test_product_search_is_registered_as_a_bounded_structured_tool():
    registered = {}

    class _Context:
        def register_tool(self, **kwargs):
            registered[kwargs["name"]] = kwargs

    breadboard.register(_Context())

    tool = registered["product_search"]
    parameters = tool["schema"]["parameters"]
    assert parameters["required"] == ["query"]
    assert parameters["properties"]["query"]["maxLength"] == 300
    assert parameters["properties"]["count"]["minimum"] == 1
    assert parameters["properties"]["count"]["maximum"] == 10
    assert "rendered by Breadboard automatically" in tool["schema"]["description"]
    assert breadboard._request_payload(
        route_kind="product_search",
        tool_name="product_search",
        args={"query": "quiet headphones", "count": 6},
        tool_call_id="call-product",
    ) == {
        "tool": "product_search",
        "args": {"query": "quiet headphones", "count": 6},
    }


def test_product_search_is_declared_in_the_plugin_manifest():
    manifest = Path(breadboard.__file__).with_name("plugin.yaml").read_text(encoding="utf-8")
    assert "  - product_search\n" in manifest.replace("\r\n", "\n")


def test_chat_search_is_registered_as_a_bounded_navigation_tool():
    registered = {}

    class _Context:
        def register_tool(self, **kwargs):
            registered[kwargs["name"]] = kwargs

    breadboard.register(_Context())

    tool = registered["chat_search"]
    parameters = tool["schema"]["parameters"]
    assert parameters["required"] == ["query"]
    assert parameters["properties"]["query"]["maxLength"] == 300
    assert parameters["properties"]["count"]["minimum"] == 1
    assert parameters["properties"]["count"]["maximum"] == 8
    assert "compact navigation widget" in tool["schema"]["description"]
    assert breadboard._request_payload(
        route_kind="chat_search",
        tool_name="chat_search",
        args={"query": "Kirchhoff laws", "count": 4},
        tool_call_id="call-chat",
    ) == {
        "tool": "chat_search",
        "args": {"query": "Kirchhoff laws", "count": 4},
    }


def test_chat_search_is_declared_in_the_plugin_manifest():
    manifest = Path(breadboard.__file__).with_name("plugin.yaml").read_text(encoding="utf-8")
    assert "  - chat_search\n" in manifest.replace("\r\n", "\n")
