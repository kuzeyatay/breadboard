"""Feynman uses the existing Breadboard tool transport without vendor credentials."""

import json
from pathlib import Path

import yaml

import plugins.breadboard as breadboard


def test_feynman_contract_and_bounded_request():
    name, route, kind, schema = next(tool for tool in breadboard._TOOLS if tool[0] == "feynman_research")
    assert route == "/api/hermes/tools/feynman"
    assert schema["parameters"]["required"] == ["query"]
    assert schema["parameters"]["properties"]["fullTextTop"]["maximum"] == 3
    assert breadboard._request_payload(
        route_kind=kind, tool_name=name, args={"query": "CRISPR", "limit": 4}, tool_call_id=None,
    ) == {"tool": "feynman_research", "args": {"query": "CRISPR", "limit": 4}}
    manifest = yaml.safe_load(Path(breadboard.__file__).with_name("plugin.yaml").read_text())
    assert name in manifest["provides_tools"]


def test_feynman_reaches_broker_with_enough_time_for_retrieval(monkeypatch):
    seen = {}

    class Response:
        status = 200

        def read(self, _limit):
            return json.dumps({"ok": True, "data": {"engine": "Feynman PaperRank", "papers": [{"title": "Source paper"}]}}).encode()

    class Connection:
        def __init__(self, _host, _port, timeout):
            seen["timeout"] = timeout

        def request(self, method, route, *, body, headers):
            seen.update(method=method, route=route, body=json.loads(body), headers=headers)

        def getresponse(self):
            return Response()

        def close(self):
            pass

    monkeypatch.setattr(breadboard, "HTTPConnection", Connection)
    # This is Breadboard's internal broker secret, not a public-source API key.
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    name, route, kind, _schema = next(tool for tool in breadboard._TOOLS if tool[0] == "feynman_research")
    result = breadboard._call_breadboard({"query": "CRISPR"}, tool_name=name, route=route, route_kind=kind, task_id="session-1", tool_call_id="call-1")
    assert seen["timeout"] == 120
    assert seen["route"] == route
    assert seen["body"] == {"tool": name, "args": {"query": "CRISPR"}}
    assert "Source paper" in result
