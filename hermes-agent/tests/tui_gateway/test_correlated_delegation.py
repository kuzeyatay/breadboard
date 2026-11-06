"""Client turns keep tool authority until their child work has been consumed."""
import queue
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from tools import async_delegation as ad
from tools.process_registry import process_registry
from tui_gateway.correlated_delegation import (
    DEFAULT_MAX_AUTO_CONTINUATIONS, auto_continuation_limit, finish_delegations, guardrail_failure,
)
from tui_gateway import server


@pytest.fixture(autouse=True)
def isolated_registry(tmp_path, monkeypatch):
    monkeypatch.setattr(ad, "_db_path", lambda: tmp_path / "delegations.db")
    monkeypatch.setattr(process_registry, "completion_queue", queue.Queue())
    ad._reset_for_tests()
    yield
    ad._reset_for_tests()


def dispatch(key="mine", runner=None):
    return ad.dispatch_async_delegation(goal="audit graphs", context=None, toolsets=None,
        role="leaf", model="test", session_key=key, origin_ui_session_id=key,
        runner=runner or (lambda: {"status": "completed", "summary": "verified graph equations"}),
        max_async_children=3)["delegation_id"]


def settled(delegation_id):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        row = ad.get_durable_delegation(delegation_id)
        if row and row["state"] != "running":
            return
        time.sleep(0.01)
    raise AssertionError("Child did not complete")


def result(text="graphs generated", calls=2):
    return {"final_response": text, "messages": [{"role": "assistant", "content": text}],
        "api_calls": calls, "completed": True}


def finish(agent, current=None, **overrides):
    return finish_delegations(agent, current or result(), {},
        owns_event=lambda e: e.get("origin_ui_session_id") == "mine",
        cancelled=overrides.get("cancelled", lambda: False),
        interim=overrides.get("interim", lambda text: None),
        waiting=overrides.get("waiting", lambda: None),
        continuing=overrides.get("continuing"),
        max_auto_continuations=overrides.get("max_auto_continuations", DEFAULT_MAX_AUTO_CONTINUATIONS))


@pytest.mark.parametrize("warning", [False, True])
def test_completed_child_is_incorporated_once_before_the_turn_finishes(warning):
    mine, foreign = dispatch(), dispatch("other")
    settled(mine)
    settled(foreign)
    seen = []
    agent = SimpleNamespace(max_iterations=90)
    def continue_work(text, **kwargs):
        assert "verified graph equations" in text
        assert agent.max_iterations == 88
        assert kwargs["conversation_history"] == result()["messages"]
        seen.append(text)
        return result("PDF exported", 3)
    agent.run_conversation = continue_work
    current = result()
    if warning:
        current["guardrail"] = {"action": "warn", "code": "no_progress_warning"}
    assert finish(agent, current)["final_response"] == "graphs generated\n\nPDF exported"
    assert len(seen) == 1
    assert ad.get_durable_delegation(mine)["delivery_state"] == "delivered"
    assert ad.get_durable_delegation(foreign)["delivery_state"] == "pending"
    assert agent.max_iterations == 90
    assert finish(agent)["final_response"] == "graphs generated"
    assert len(seen) == 1


def test_waits_for_running_child_and_cancellation_does_not_launch_another_call():
    gate = threading.Event()
    child = dispatch(runner=lambda: (gate.wait(4), {"status": "completed"})[1])
    cancelled = threading.Event()
    agent = SimpleNamespace(max_iterations=90, run_conversation=Mock())
    try:
        out = finish(agent, cancelled=cancelled.is_set, waiting=cancelled.set)
        assert out["interrupted"] is True
        agent.run_conversation.assert_not_called()
    finally:
        gate.set()
        settled(child)


def test_synthesizing_result_can_spawn_another_child_without_resetting_budget():
    first = dispatch()
    settled(first)
    budgets = []
    agent = SimpleNamespace(max_iterations=10)
    def run(text, **kwargs):
        budgets.append(agent.max_iterations)
        if len(budgets) == 1:
            settled(dispatch())
        return result("done", calls=3)
    agent.run_conversation = run
    finish(agent)
    assert budgets == [8, 5]
    assert agent.max_iterations == 10


def test_guard_stop_and_disabled_continuation_cannot_be_bypassed_by_child_results():
    child = dispatch()
    settled(child)
    agent = SimpleNamespace(max_iterations=2, run_conversation=Mock())
    guarded = {**result(), "guardrail": {"action": "halt", "code": "repeated_exact_failure_block"}}
    assert finish(agent, guarded) is guarded
    exhausted = finish(agent, max_auto_continuations=0)
    assert "continuation limit" in exhausted["error"]
    assert exhausted["error"] in exhausted["final_response"]
    agent.run_conversation.assert_not_called()
    assert ad.get_durable_delegation(child)["delivery_state"] == "pending"


def test_failed_synthesis_keeps_result_retryable_and_restores_budget():
    child = dispatch()
    settled(child)
    agent = SimpleNamespace(max_iterations=90, run_conversation=Mock(side_effect=RuntimeError("offline")))
    with pytest.raises(RuntimeError, match="offline"):
        finish(agent)
    assert agent.max_iterations == 90
    assert ad.get_durable_delegation(child)["delivery_state"] == "pending"
    agent.run_conversation = Mock(return_value=result("PDF exported"))
    assert finish(agent)["final_response"] == "graphs generated\n\nPDF exported"


@pytest.mark.parametrize("has_child", [False, True])
def test_iteration_limit_automatically_resumes_saved_work(has_child):
    child = dispatch() if has_child else None
    if child:
        settled(child)
    current = {**result("PDF compilation checkpoint", calls=2),
        "completed": False, "turn_exit_reason": "max_iterations_reached(2/2)"}
    history = current["messages"]
    agent = SimpleNamespace(max_iterations=2)

    def resume(text, **kwargs):
        assert kwargs["conversation_history"] is history
        assert agent.max_iterations == 2
        assert "Continue" in text
        if has_child:
            assert "verified graph equations" in text
        return result("PDF exported", calls=1)

    agent.run_conversation = Mock(side_effect=resume)
    out = finish(agent, current)
    assert out["final_response"] == "PDF compilation checkpoint\n\nPDF exported"
    assert out["completed"] is True
    assert not out.get("error")
    agent.run_conversation.assert_called_once()
    assert agent.max_iterations == 2
    if child:
        assert ad.get_durable_delegation(child)["delivery_state"] == "delivered"


@pytest.mark.parametrize("ending", ["normal", "guarded", "limit_with_child", "limit_without_child"])
def test_real_prompt_dispatch_emits_only_one_correlated_completion(monkeypatch, tmp_path, ending):
    events = []
    child_ids = []
    calls = []
    agent = SimpleNamespace(model="test", provider="test", max_iterations=90,
        clear_interrupt=lambda: None, step_callback=None,
        _interim_content_was_streamed=lambda text: not ending.startswith("limit_"))
    table = "| Subsection | Slides |\n|---|---|\n| 14.2 Phasors | Lecture 12 |"
    session = {"agent": agent, "session_key": "mine", "history": [],
        "history_lock": threading.Lock(), "history_version": 0, "running": True,
        "active_client_turn_id": "run-pdf", "attached_images": [], "cols": 80}
    monkeypatch.setitem(server._sessions, "mine", session)
    for name in ["_wire_callbacks", "_sync_agent_model_with_config", "_register_session_cwd",
                 "_clear_session_context", "_sync_session_key_after_compress"]:
        monkeypatch.setattr(server, name, lambda *a, **k: None)
    monkeypatch.setattr(server, "_session_cwd", lambda s: str(tmp_path))
    monkeypatch.setattr(server, "_set_session_context", lambda *a, **k: [])
    monkeypatch.setattr(server, "_session_info", lambda *a: {})
    monkeypatch.setattr(server, "_get_usage", lambda a: {"api_calls": len(calls)})
    monkeypatch.setattr(server, "_get_db", lambda: None)
    monkeypatch.setattr(server, "_drain_queued_prompt", lambda *a: False)
    monkeypatch.setattr(server, "_voice_tts_enabled", lambda: False)
    monkeypatch.setattr(server, "_tts_stream_begin", lambda: None)
    monkeypatch.setattr(server, "make_stream_renderer", lambda c: None)
    monkeypatch.setattr(server, "render_message", lambda *a: None)
    monkeypatch.setattr(server, "_emit", lambda kind, sid, payload=None: events.append((kind, payload)))
    def run(text, **kwargs):
        calls.append(text)
        if len(calls) == 1:
            if ending == "guarded":
                return {**result(), "guardrail": {"action": "block", "code": "repeated_exact_failure_block",
                    "message": "The same command failed repeatedly."}}
            if ending != "limit_without_child":
                child = dispatch()
                child_ids.append(child)
                settled(child)
            if ending.startswith("limit_"):
                return {**result(table, calls=90), "completed": False,
                    "turn_exit_reason": "max_iterations_reached(90/90)"}
            return result()
        assert session["running"] is True
        assert session["active_client_turn_id"] == "run-pdf"
        assert not any(kind == "message.complete" for kind, _ in events)
        return result("PDF exported")
    agent.run_conversation = run
    server._run_prompt_submit("request", "mine", session, "make PDF", client_turn_id="run-pdf")
    session["_run_thread"].join(8)
    assert not session["_run_thread"].is_alive()
    completed = [payload for kind, payload in events if kind == "message.complete"]
    assert len(completed) == 1, events
    if ending == "guarded":
        assert completed[0]["status"] == "error"
        assert completed[0]["failure_reason"] == "repeated_exact_failure_block"
        assert "tool-loop guard" in completed[0]["text"]
        assert completed[0]["turn_id"] == "run-pdf"
        assert len(calls) == 1
        return
    expected = (table if ending.startswith("limit_") else "graphs generated") + "\n\nPDF exported"
    assert completed[0]["text"] == expected, events
    assert completed[0]["turn_id"] == "run-pdf"
    assert completed[0]["status"] == "complete"
    assert len(calls) == 2
    interim_events = [payload for kind, payload in events if kind == "message.interim"]
    assert len(interim_events) == 1
    assert interim_events[0]["already_streamed"] is (not ending.startswith("limit_"))
    if child_ids:
        assert ad.get_durable_delegation(child_ids[0])["delivery_state"] == "delivered"
    if ending.startswith("limit_"):
        assert any(kind == "status.update" and payload.get("text") == "Continuing automatically from saved work"
            and payload.get("turn_id") == "run-pdf" for kind, payload in events)


@pytest.mark.parametrize("shutdown", [False, True])
def test_idle_poller_keeps_client_owned_results_for_an_authorized_turn(monkeypatch, shutdown):
    child = dispatch()
    settled(child)
    stop = threading.Event()
    if shutdown:
        stop.set()
    else:
        monkeypatch.setattr(server.time, "sleep", lambda seconds: stop.set())
    session = {"session_key": "mine", "history_lock": threading.Lock(),
        "client_managed_turns": True, "running": False}
    monkeypatch.setitem(server._sessions, "mine", session)
    launch = Mock()
    monkeypatch.setattr(server, "_run_prompt_submit", launch)
    server._notification_poller_loop(stop, "mine", session)
    launch.assert_not_called()
    assert ad.get_durable_delegation(child)["delivery_state"] == "pending"
    assert not process_registry.completion_queue.empty()


def test_guardrail_failure_is_explicit_and_warnings_remain_nonfatal():
    assert guardrail_failure({}) is None
    assert guardrail_failure({"guardrail": {"action": "warn"}}) is None
    code, message = guardrail_failure({"guardrail": {"action": "block", "code": "exploration_limit", "message": "Stopped tools"}})
    assert code == "exploration_limit"
    assert "tool-loop guard" in message


@pytest.mark.parametrize("exit_reason", [None, "max_iterations_reached(90/90)", "budget_exhausted"])
def test_late_child_addendum_preserves_the_complete_answer_and_history(exit_reason):
    child = dispatch()
    settled(child)
    table = "| Topic | Slides | Transcript |\n|---|---|---|\n| Phasors | L11 | 16 October |"
    addition = "One addition to the table above: Lecture 11 introduces phasors on page 16."
    current = result(table)
    if exit_reason:
        current.update(api_calls=90, completed=False, turn_exit_reason=exit_reason)
    history = current["messages"]
    interim = []
    agent = SimpleNamespace(max_iterations=90)

    def run(text, **kwargs):
        assert "verified graph equations" in text
        assert "appended to the previous answer" in text
        assert kwargs["conversation_history"] is history
        return {**result(addition), "messages": [*history, {"role": "assistant", "content": addition}]}

    agent.run_conversation = run
    out = finish(agent, current, interim=interim.append)
    assert out["final_response"] == table + "\n\n" + addition
    assert interim == [table]
    assert history == [{"role": "assistant", "content": table}]
    assert out["messages"][-1]["content"] == addition


def test_multiple_budget_windows_keep_each_part_of_the_answer_without_replaying_history():
    first = "| Subsection | Slides |\n|---|---|\n| 1.1 Vectors | Lecture 1 |"
    second = "| Subsection | Slides |\n|---|---|\n| 16.2 Skin effect | Lecture 13 |"
    correction = "The additional checks reinforce the partial-coverage warnings in the table."
    current = {**result(first, 2), "completed": False, "turn_exit_reason": "budget_exhausted"}
    history = current["messages"]
    calls = []
    agent = SimpleNamespace(max_iterations=2)

    def resume(text, **kwargs):
        nonlocal history
        assert kwargs["conversation_history"] is history
        calls.append(text)
        answer = second if len(calls) == 1 else correction
        history = [*history, {"role": "user", "content": text}, {"role": "assistant", "content": answer}]
        return {**result(answer, 2 if len(calls) == 1 else 1), "messages": history,
                "turn_exit_reason": "budget_exhausted" if len(calls) == 1 else "text_response(finish_reason=stop)"}

    agent.run_conversation = resume
    out = finish(agent, current)
    assert len(calls) == 2
    assert out["final_response"] == first + "\n\n" + second + "\n\n" + correction
    assert out["messages"][-1]["content"] == correction
    assert current["messages"] == [{"role": "assistant", "content": first}]


@pytest.mark.parametrize("ending", ["empty", "repeat", "error", "cancel", "limit"])
def test_late_child_exit_does_not_discard_an_earlier_answer(ending):
    settled(dispatch())
    agent = SimpleNamespace(max_iterations=5)
    cancelled = threading.Event()

    def run(text, **kwargs):
        if ending == "cancel":
            cancelled.set()
        if ending == "limit":
            settled(dispatch())
        return {
            **result("" if ending == "empty" else "Full table" if ending == "repeat" else "Correction", calls=3),
            **({"error": "offline", "completed": False} if ending == "error" else {}),
        }

    agent.run_conversation = run
    out = finish(agent, result("Full table"), cancelled=cancelled.is_set, max_auto_continuations=0)
    assert out["final_response"].startswith("Full table")
    assert out["final_response"].count("Full table") == 1
    if ending not in {"empty", "repeat"}:
        assert "Correction" in out["final_response"]
    if ending == "error":
        assert out["error"] == "offline"
    if ending == "cancel":
        assert out["interrupted"] is True
    if ending == "limit":
        assert "continuation limit" in out["error"]


@pytest.mark.parametrize("cfg, expected", [
    ({}, DEFAULT_MAX_AUTO_CONTINUATIONS),
    ({"agent": {"max_auto_continuations": 0}}, 0),
    ({"agent": {"max_auto_continuations": "3"}}, 3),
    ({"agent": {"max_auto_continuations": -1}}, 0),
    ({"agent": {"max_auto_continuations": None}}, DEFAULT_MAX_AUTO_CONTINUATIONS),
    ({"agent": {"max_auto_continuations": "invalid"}}, DEFAULT_MAX_AUTO_CONTINUATIONS),
    ({"agent": {"max_auto_continuations": True}}, DEFAULT_MAX_AUTO_CONTINUATIONS),
])
def test_continuation_setting(cfg, expected):
    assert auto_continuation_limit(cfg) == expected


def test_completed_answer_at_exact_limit_does_not_continue_without_children():
    agent = SimpleNamespace(max_iterations=2, run_conversation=Mock())
    current = result("Done. The source mentions max_iterations_reached(2/2).")
    assert finish(agent, current) is current
    agent.run_conversation.assert_not_called()


def test_child_results_can_renew_a_shared_budget_after_a_completed_answer():
    child = dispatch()
    settled(child)
    agent = SimpleNamespace(max_iterations=2, run_conversation=Mock(return_value=result("Correction", 1)))
    renewed = []
    out = finish(agent, continuing=renewed.append)
    assert out["final_response"] == "graphs generated\n\nCorrection"
    assert renewed == [1]
    assert ad.get_durable_delegation(child)["delivery_state"] == "delivered"


def test_repeated_exhaustion_is_bounded_and_uses_the_latest_history():
    current = {**result("checkpoint", 2), "completed": False,
        "turn_exit_reason": "max_iterations_reached(2/2)"}
    expected_history = current["messages"]
    agent = SimpleNamespace(max_iterations=2)
    renewed = []

    def resume(text, **kwargs):
        nonlocal expected_history
        assert kwargs["conversation_history"] is expected_history
        assert agent.max_iterations == 2
        expected_history = [*expected_history, {"role": "user", "content": text},
            {"role": "assistant", "content": "next checkpoint"}]
        return {**current, "messages": expected_history}

    agent.run_conversation = Mock(side_effect=resume)
    out = finish(agent, current, continuing=renewed.append, max_auto_continuations=2)
    assert agent.run_conversation.call_count == 2
    assert renewed == [1, 2]
    assert out["completed"] is False
    assert "after 2 restarts" in out["error"]
    assert out["messages"] is expected_history
    assert agent.max_iterations == 2


@pytest.mark.parametrize("stop", [
    {"interrupted": True}, {"failed": True}, {"partial": True}, {"error": "offline"},
    {"guardrail": {"action": "halt", "code": "repeated_exact_failure_block"}},
])
def test_limit_does_not_override_other_stops(stop):
    child = dispatch()
    settled(child)
    current = {**result(calls=2), "completed": False,
        "turn_exit_reason": "max_iterations_reached(2/2)", **stop}
    agent = SimpleNamespace(max_iterations=2, run_conversation=Mock())
    assert finish(agent, current) is current
    agent.run_conversation.assert_not_called()
    assert ad.get_durable_delegation(child)["delivery_state"] == "pending"


def test_cancellation_during_renewal_does_not_consume_the_child_result():
    child = dispatch()
    settled(child)
    cancelled = threading.Event()
    agent = SimpleNamespace(max_iterations=2, run_conversation=Mock())
    out = finish(agent, cancelled=cancelled.is_set, continuing=lambda count: cancelled.set())
    assert out["interrupted"] is True
    agent.run_conversation.assert_not_called()
    assert ad.get_durable_delegation(child)["delivery_state"] == "pending"


def test_renewal_preserves_stream_task_and_pending_user_followup():
    current = {**result(calls=2), "completed": False,
        "turn_exit_reason": "max_iterations_reached(2/2)", "pending_steer": "Include the answer key"}
    stream = Mock()
    agent = SimpleNamespace(max_iterations=2, run_conversation=Mock(return_value=result("PDF exported", 1)))
    finish_delegations(agent, current, {"stream_callback": stream, "task_id": "original-task"},
        owns_event=lambda e: False, cancelled=lambda: False, interim=lambda text: None, waiting=lambda: None)
    args, kwargs = agent.run_conversation.call_args
    assert "Include the answer key" in args[0]
    assert kwargs["task_id"] == "original-task"
    assert kwargs["stream_callback"] is stream
    assert kwargs["conversation_history"] is current["messages"]
