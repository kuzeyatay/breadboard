"""delegate_task children authorize Breadboard tool calls under the root session.

A child agent runs its tools under its own ``sa-<n>-<hex>`` task id. Breadboard
only knows the root session, so the plugin must resolve the child back to the
root before sending ``X-Agent-Session-ID`` — otherwise every tool a child
inherits fails with ``runtime_session_not_found``.
"""

import json

import plugins.breadboard as breadboard
import tools.delegate_tool as delegate_tool


class _Response:
    status = 200

    def read(self, _limit: int) -> bytes:
        return json.dumps({"ok": True, "data": {"gardens": []}}).encode("utf-8")


class _Connection:
    headers: list = []

    def __init__(self, _host: str, _port: int, timeout: int):
        self.timeout = timeout

    def request(self, _method: str, _route: str, *, body: bytes, headers: dict):
        self.headers.append(headers)

    def getresponse(self):
        return _Response()

    def close(self):
        return None


def _call(monkeypatch, task_id: str) -> dict:
    _Connection.headers = []
    monkeypatch.setattr(breadboard, "HTTPConnection", _Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    breadboard._call_breadboard(
        {},
        tool_name="garden_list",
        route="/api/hermes/tools/garden",
        route_kind="garden",
        task_id=task_id,
    )
    assert _Connection.headers, "the plugin never reached Breadboard"
    return _Connection.headers[-1]


def test_root_session_passes_through_unchanged(monkeypatch):
    headers = _call(monkeypatch, "root-session")
    assert headers["X-Agent-Session-ID"] == "root-session"
    assert "X-Agent-Subagent-ID" not in headers


def test_child_task_resolves_to_root_session(monkeypatch):
    delegate_tool._register_child_task("sa-0-aaaaaaaa", "root-session")
    try:
        headers = _call(monkeypatch, "sa-0-aaaaaaaa")
    finally:
        delegate_tool._unregister_child_task("sa-0-aaaaaaaa")
    assert headers["X-Agent-Session-ID"] == "root-session"
    assert headers["X-Agent-Subagent-ID"] == "sa-0-aaaaaaaa"


def test_nested_child_resolves_transitively(monkeypatch):
    delegate_tool._register_child_task("sa-0-aaaaaaaa", "root-session")
    delegate_tool._register_child_task("sa-1-bbbbbbbb", "sa-0-aaaaaaaa")
    try:
        headers = _call(monkeypatch, "sa-1-bbbbbbbb")
    finally:
        delegate_tool._unregister_child_task("sa-1-bbbbbbbb")
        delegate_tool._unregister_child_task("sa-0-aaaaaaaa")
    assert headers["X-Agent-Session-ID"] == "root-session"
    assert headers["X-Agent-Subagent-ID"] == "sa-1-bbbbbbbb"


def test_unregistered_child_no_longer_resolves(monkeypatch):
    delegate_tool._register_child_task("sa-0-cccccccc", "root-session")
    delegate_tool._unregister_child_task("sa-0-cccccccc")
    assert delegate_tool.resolve_root_task_id("sa-0-cccccccc") == "sa-0-cccccccc"
    headers = _call(monkeypatch, "sa-0-cccccccc")
    assert headers["X-Agent-Session-ID"] == "sa-0-cccccccc"
