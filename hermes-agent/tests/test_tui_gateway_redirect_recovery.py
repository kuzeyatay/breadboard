"""A live correction must not turn recovery into a false interruption."""

import threading
import types

import pytest

from tui_gateway import server


@pytest.fixture
def live_turn(monkeypatch):
    session = {
        "agent": types.SimpleNamespace(
            _supports_active_turn_redirect=True, redirect=lambda text: True,
        ),
        "history_lock": threading.Lock(),
        "running": True,
        "active_client_turn_id": "lab-turn",
        "inflight_turn": {"user": "Run the lab", "assistant": "Installing"},
        "history": [
            {"role": "user", "content": "Run the lab"},
            {"role": "assistant", "content": "Installing", "tool_calls": [
                {"id": "install", "type": "function", "function": {
                    "name": "terminal", "arguments": "{}",
                }},
            ]},
            {"role": "tool", "tool_call_id": "install", "content": "done"},
        ],
    }
    monkeypatch.setitem(server._sessions, "lab-session", session)
    return session


def recover(turn_id="lab-turn", expected="Run the lab"):
    return server._methods["session.turn_result"]("result", {
        "session_id": "lab-session", "turn_id": turn_id,
        "expected_user_text": expected,
    })["result"]


def test_redirect_keeps_original_turn_running(live_turn):
    redirected = server._methods["session.redirect"]("redirect", {
        "session_id": "lab-session", "expected_turn_id": "lab-turn",
        "queue_if_unavailable": False, "text": "Only continue the lab",
    })
    assert redirected["result"]["status"] == "redirected"
    assert live_turn["inflight_turn"]["user"] == "Only continue the lab"
    assert recover() == {"state": "running", "turn_id": "lab-turn"}


def test_live_identity_does_not_claim_another_turn(live_turn):
    assert recover("different-turn", "Different request")["state"] == "unknown"


def test_legacy_identity_requires_matching_prompt(live_turn):
    live_turn.pop("active_client_turn_id")
    assert recover()["state"] == "running"
    assert recover(expected="Different request")["state"] == "unknown"


def test_stopped_protocol_incomplete_turn_remains_failed(live_turn):
    live_turn["running"] = False
    result = recover()
    assert result["state"] == "failed"
    assert result["payload"]["failure_reason"] == "interrupted_tool_turn"


def test_redirect_preserves_pending_clarification(live_turn, monkeypatch):
    live_turn["inflight_turn"]["user"] = "Only continue the lab"
    clarification = {"question": "Which lab group?"}
    monkeypatch.setattr(server, "_pending_clarify_for_session", lambda sid: clarification)
    result = recover()
    assert result["state"] == "waiting_for_clarification"
    assert result["clarify"] == clarification
