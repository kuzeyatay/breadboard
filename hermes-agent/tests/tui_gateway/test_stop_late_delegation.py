"""Stop is durable, session-scoped, and cannot be undone by a late child."""
import threading
import io
from unittest.mock import MagicMock, patch

import pytest
from tools import async_delegation as ad
from tools.process_registry import process_registry
from tui_gateway.server import _notification_was_cancelled, _run_prompt_submit


@pytest.fixture(autouse=True)
def isolated_delegations(tmp_path, monkeypatch):
    monkeypatch.setattr(ad, "_db_path", lambda: tmp_path / "state.db")
    ad._reset_for_tests()
    yield
    ad._reset_for_tests()


def dispatch(key, runner, interrupt=None):
    return ad.dispatch_async_delegation(goal="read image", context=None, toolsets=None,
        role="leaf", model="m", session_key=key, origin_ui_session_id=key,
        runner=runner, interrupt_fn=interrupt, max_async_children=3)["delegation_id"]


def completion(delegation_id):
    for _ in range(20):
        event = process_registry.completion_queue.get(timeout=2)
        if event.get("delegation_id") == delegation_id:
            return event
    raise AssertionError("No completion event")


def test_stop_interrupts_child_and_late_finish_cannot_restore_delivery():
    gate = threading.Event()
    interrupted = MagicMock()
    def runner():
        gate.wait(5)
        return {"status": "completed", "summary": "late answer"}
    mine = dispatch("mine", runner, interrupted)
    try:
        assert ad.cancel_for_session(session_key="mine") == 1
        interrupted.assert_called_once()
    finally:
        gate.set()
    event = completion(mine)
    assert ad.claim_event_delivery(event, "test") is None
    with ad._connect() as db:
        assert db.execute("SELECT delivery_state FROM async_delegations WHERE delegation_id=?", (mine,)).fetchone()[0] == "dropped"
    # Stop does not permanently disable this conversation.
    fresh = dispatch("mine", lambda: {"status": "completed", "summary": "new work"})
    assert ad.claim_event_delivery(completion(fresh), "test") is not None


def test_stop_drops_already_queued_results_without_touching_other_sessions():
    mine = dispatch("mine", lambda: {"status": "completed"})
    mine_event = completion(mine)
    foreign = dispatch("foreign", lambda: {"status": "completed"})
    foreign_event = completion(foreign)
    ad.cancel_for_session(origin_ui_session_id="mine")
    assert ad.claim_event_delivery(mine_event, "test") is None
    assert ad.claim_event_delivery(foreign_event, "test") is not None


def test_claimed_completion_cannot_clear_stop_or_start_a_model_call():
    agent = MagicMock()
    session = {"agent": agent, "history_lock": threading.Lock(), "running": True,
        "_notifications_cancelled_at": 20}
    event = {"type": "async_delegation", "dispatched_at": 10}
    with patch("tui_gateway.server._emit") as emit:
        _run_prompt_submit(1, "mine", session, "late result", notification_event=event)
    assert session["running"] is False
    agent.clear_interrupt.assert_not_called()
    agent.run_conversation.assert_not_called()
    emit.assert_not_called()
    assert not _notification_was_cancelled(session, {**event, "dispatched_at": 21})
    assert _notification_was_cancelled(session, {"type": "async_delegation"})


def test_compute_host_stop_latches_before_interrupting_and_cancels_its_children(monkeypatch):
    from tui_gateway import server
    from tui_gateway.compute_host import ComputeHost
    host = ComputeHost(stdout=io.StringIO(), heartbeat_secs=0)
    session = {"agent": MagicMock(), "session_key": "mine", "running": True,
        "history_lock": threading.Lock(), "queued_prompt": "stale"}
    monkeypatch.setitem(server._sessions, "stop-host", session)
    def interrupted():
        assert session["_turn_cancel_requested"] is True
        assert session["_notifications_cancelled_at"] > 0
    session["agent"].interrupt.side_effect = interrupted
    try:
        with patch.object(ad, "cancel_for_session") as cancel:
            host._handle_interrupt({"sid": "stop-host"})
        cancel.assert_called_once_with(session_key="mine", origin_ui_session_id="stop-host")
        session["agent"].interrupt.assert_called_once()
        assert session["queued_prompt"] is None
    finally:
        host.close()


def test_reused_compute_host_session_receives_each_turns_current_tool_policy():
    from types import SimpleNamespace
    from tui_gateway.compute_host import ComputeHost
    host = ComputeHost(stdout=io.StringIO(), heartbeat_secs=0)
    session = {"tool_access": {"web_search": True}}
    server = SimpleNamespace(_sessions={"s": session})
    try:
        restored = host._ensure_server_session(server, {"sid": "s",
            "tool_access": {"web_search": False}, "tool_loop_guardrails": {"exploration_limit": 8}})
        assert restored is session
        assert restored["tool_access"]["web_search"] is False
        assert restored["tool_loop_guardrails"]["exploration_limit"] == 8
    finally:
        host.close()
