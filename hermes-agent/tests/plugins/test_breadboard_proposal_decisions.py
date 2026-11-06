import json
from types import SimpleNamespace

import plugins.breadboard as breadboard


def test_proposal_decisions_use_authenticated_broker_and_preserve_partial_results(monkeypatch):
    registered = {}
    breadboard.register(SimpleNamespace(register_tool=lambda **tool: registered.update({tool["name"]: tool})))
    requests = []
    results = {"complete": False, "results": [{"id": 28, "status": "applied"}, {"id": 29, "status": "failed", "error": "Revision conflict"}]}

    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, method, route, *, body, headers):
            assert route == "/api/hermes/tools/garden"
            requests.append(json.loads(body))

        def getresponse(self):
            return SimpleNamespace(status=200, read=lambda limit: json.dumps({"ok": True, "data": results}).encode())

        def close(self):
            pass

    monkeypatch.setattr(breadboard, "HTTPConnection", Connection)
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "test-secret")
    tool = registered["garden_decide_proposals"]
    args = {"gardenId": "ec-2", "proposalIds": [28, 29], "decision": "apply"}
    result = json.loads(tool["handler"](args, task_id="proposal-chat"))
    assert requests == [{"tool": "garden_decide_proposals", "args": args}]
    assert result == results
