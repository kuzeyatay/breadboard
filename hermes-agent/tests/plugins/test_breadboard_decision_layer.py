import json

import pytest

from agent import tool_access_escalation as escalation
import plugins.breadboard as breadboard


@pytest.fixture(autouse=True)
def _reset_handler():
    yield
    escalation.register_escalation_handler(None)


def test_without_a_handler_the_old_refusal_stands():
    access = {"agent_launch": False}
    blocked = escalation.escalate(access, "agent_launch", {}, "t")
    assert json.loads(blocked) == {"error": "agent_launch is disabled for this turn."}
    assert escalation.escalate(access, "web_search", {}, "t") is None


def test_a_handler_can_switch_the_tool_on_for_the_rest_of_the_turn():
    def grant(access, name, args, task_id):
        access[name] = True
        return None

    escalation.register_escalation_handler(grant)
    access = {"agent_launch": False}
    assert escalation.escalate(access, "agent_launch", {}, "t") is None
    assert access["agent_launch"] is True


def test_a_handler_that_forgets_to_grant_still_refuses():
    escalation.register_escalation_handler(lambda access, name, args, task_id: None)
    assert escalation.escalate({"x": False}, "x", {}, "t") is not None


def test_a_failing_handler_keeps_the_safe_refusal():
    def boom(*_args):
        raise RuntimeError("dashboard down")

    escalation.register_escalation_handler(boom)
    assert "disabled for this turn" in escalation.escalate({"x": False}, "x", {}, "t")


def test_plugin_grants_after_the_approval_gate(monkeypatch):
    calls = []

    def fake_request(task_id, payload):
        calls.append(payload["phase"])
        return {"status": "grantable", "label": "launch a team of agents", "prompt": "Allow?"} \
            if payload["phase"] == "check" else {"status": "granted"}

    approvals = []
    monkeypatch.setattr(breadboard, "_capability_request", fake_request)
    monkeypatch.setattr("tools.approval.request_tool_approval",
                        lambda tool, reason, **kw: approvals.append((tool, kw.get("rule_key"))) or {"approved": True})
    access = {"agent_launch": False}
    assert breadboard._escalate_tool_access(access, "agent_launch", {"team_action": "start"}, "sess") is None
    assert access["agent_launch"] is True
    assert calls == ["check", "grant"]
    assert approvals == [("agent_launch", "breadboard-capability:agent_launch")]


def test_plugin_respects_a_denied_card(monkeypatch):
    monkeypatch.setattr(breadboard, "_capability_request",
                        lambda task_id, payload: {"status": "grantable", "label": "x", "prompt": "p"})
    monkeypatch.setattr("tools.approval.request_tool_approval",
                        lambda *a, **kw: {"approved": False, "message": "Denied by the user."})
    access = {"agent_launch": False}
    assert breadboard._escalate_tool_access(access, "agent_launch", {}, "sess") == "Denied by the user."
    assert access["agent_launch"] is False


def test_plugin_passes_through_a_policy_refusal(monkeypatch):
    monkeypatch.setattr(breadboard, "_capability_request",
                        lambda task_id, payload: {"status": "denied", "message": "Not in a public chat."})
    access = {"agent_launch": False}
    assert breadboard._escalate_tool_access(access, "agent_launch", {}, "sess") == "Not in a public chat."
    assert access["agent_launch"] is False


def test_subagent_concurrency_follows_codex_floor_and_batches_are_uncapped():
    from tools import delegate_tool

    assert 6 <= delegate_tool._auto_concurrent_children() <= 16
    source = open(delegate_tool.__file__, encoding="utf-8").read()
    assert "Too many tasks" not in source
