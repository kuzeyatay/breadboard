import threading
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from tui_gateway import idle_compaction, server


def make_session(agent, **extra):
    return dict(agent=agent, session_key="idle-test", source="breadboard",
                breadboard_contract_validated=True, history=[], history_version=0,
                history_lock=threading.Lock(), running=True, attached_images=[], **extra)


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    for name in ("_wire_callbacks", "_sync_agent_model_with_config", "_register_session_cwd",
                 "_clear_session_context", "_ensure_session_db_row", "_persist_branch_seed",
                 "_start_agent_build", "_sync_session_key_after_compress"):
        monkeypatch.setattr(server, name, lambda *a, **k: None)
    monkeypatch.setattr(server, "_wait_agent", lambda *a: None)
    monkeypatch.setattr(server, "_set_session_context", lambda *a, **k: [])
    monkeypatch.setattr(server, "_session_cwd", lambda *a: str(tmp_path))
    monkeypatch.setattr(server, "_session_info", lambda *a: {})
    monkeypatch.setattr(server, "_get_usage", lambda *a: {})
    monkeypatch.setattr(server, "_get_db", lambda: None)
    monkeypatch.setattr(server, "_session_uses_compute_host", lambda *a: False)
    monkeypatch.setattr(server, "_voice_tts_enabled", lambda: False)
    monkeypatch.setattr(server, "_tts_stream_begin", lambda: None)
    monkeypatch.setattr(server, "make_stream_renderer", lambda *a: None)
    monkeypatch.setattr(server, "render_message", lambda *a: None)
    monkeypatch.setattr(server, "_load_interim_assistant_messages", lambda: False)
    monkeypatch.setattr(server, "finish_delegations", lambda agent, result, *a, **k: result)
    monkeypatch.setattr(server, "_load_cfg", lambda: {})
    monkeypatch.setattr("agent.title_generator.maybe_auto_title", lambda *a, **k: None)
    events = []
    monkeypatch.setattr(server, "_emit", lambda kind, sid, payload=None: events.append((kind, payload)))
    return events


@pytest.mark.parametrize("fail", [False, True])
def test_completed_reply_is_delivered_while_next_prompt_waits(runtime, monkeypatch, fail):
    entered, release, second = threading.Event(), threading.Event(), threading.Event()
    later = threading.Event()
    calls = []
    agent = SimpleNamespace(model="test", provider="test", clear_interrupt=lambda: None,
                            interrupt=Mock(), ephemeral_system_prompt="original")

    def run(prompt, conversation_history, **kwargs):
        calls.append((prompt, conversation_history, agent.ephemeral_system_prompt, agent.tool_access))
        if prompt == "next":
            second.set()
        if prompt == "later":
            later.set()
        return {"final_response": "reply", "messages": conversation_history + [
            {"role": "user", "content": prompt}, {"role": "assistant", "content": "reply"}]}

    agent.run_conversation = run
    session = make_session(agent)
    monkeypatch.setitem(server._sessions, "idle", session)

    def compact(current):
        if len(calls) > 1:
            return False
        # A completed, recoverable reply must precede all slow maintenance.
        assert any(k == "message.complete" for k, _ in runtime)
        entered.set()
        assert release.wait(10)
        server._status_update("idle", "lifecycle", "Compacting context")
        if fail:
            raise RuntimeError("summary unavailable")
        with current["history_lock"]:
            current["history"] = [{"role": "assistant", "content": "summary"}]
            current["history_version"] += 1
        return True

    monkeypatch.setattr(idle_compaction, "compact_completed_turn", compact)
    server._run_prompt_submit("r1", "idle", session, "first", client_turn_id="first-id")
    first_thread = session["_run_thread"]
    try:
        assert entered.wait(10)
        answer = server._methods["session.turn_result"]("r", {"session_id": "idle", "turn_id": "first-id"})
        assert answer["result"]["state"] == "completed"
        response = server._prompt_submit("r2", {"session_id": "idle", "text": "next",
            "client_turn_id": "next-id", "system_prompt": "next context", "tool_access": {"read": True}})
        assert response["result"]["status"] == "queued"
        assert agent.ephemeral_system_prompt == "original"
        assert not second.is_set()
        assert not agent.interrupt.called
        pending = server._methods["session.turn_result"]("r", {"session_id": "idle", "turn_id": "next-id"})
        assert pending["result"]["state"] == "running"
    finally:
        release.set()
        first_thread.join(10)
    assert second.wait(10)
    session["_run_thread"].join(10)
    assert calls[1][2:] == ("next context", {"read": True})
    assert calls[1][1][0]["content"] == ("first" if fail else "summary")
    assert not [e for e in runtime if e[0] == "status.update"]
    assert not [e for e in runtime if e[0] == "error"]
    assert any(k == "message.complete" and p.get("turn_id") == "next-id" for k, p in runtime)
    assert session["running"] is False
    assert not session.get("_post_turn_maintenance")
    response = server._prompt_submit("r3", {"session_id": "idle", "text": "later", "client_turn_id": "later-id"})
    assert response["result"]["status"] == "streaming"
    assert later.wait(10)
    session["_run_thread"].join(10)
    assert calls[-1][0] == "later"


def test_queue_keeps_separate_images_and_ids(runtime, monkeypatch):
    agent = SimpleNamespace(ephemeral_system_prompt="old")
    session = make_session(agent, _post_turn_maintenance=True)
    monkeypatch.setitem(server._sessions, "idle", session)
    for i in range(2):
        session["attached_images"] = [f"image-{i}"]
        server._prompt_submit(str(i), {"session_id": "idle", "text": f"question-{i}", "client_turn_id": f"turn-{i}"})
    queued = session["_maintenance_prompts"]
    assert [q["images"] for q in queued] == [["image-0"], ["image-1"]]
    assert [q["params"]["client_turn_id"] for q in queued] == ["turn-0", "turn-1"]


@pytest.mark.parametrize("condition", ["small", "disabled", "cooldown", "just_compacted", "no_middle", "cancelled"])
def test_skips_unnecessary_or_blocked_compaction(condition, monkeypatch):
    compressor = SimpleNamespace(last_prompt_tokens=9800, last_completion_tokens=100,
        threshold_tokens=10000, has_content_to_compress=lambda _: condition != "no_middle",
        awaiting_real_usage_after_compression=condition == "just_compacted",
        should_compress=lambda tokens: tokens >= 10000 and condition != "cooldown")
    if condition == "small":
        compressor.last_prompt_tokens = 20
    agent = SimpleNamespace(compression_enabled=condition != "disabled", context_compressor=compressor,
                            _compress_context=Mock())
    session = make_session(agent, _turn_cancel_requested=condition == "cancelled")
    session["history"] = [{"role": "user", "content": "history"}]
    monkeypatch.setattr(idle_compaction, "estimate_request_tokens_rough", lambda *a, **k: 20)
    assert idle_compaction.compact_completed_turn(session) is False
    agent._compress_context.assert_not_called()


@pytest.mark.parametrize("in_place", [False, True])
def test_real_compression_persists_summary_and_recent_reply(tmp_path, monkeypatch, in_place):
    from hermes_state import SessionDB
    from run_agent import AIAgent

    monkeypatch.setattr("hermes_cli.config.load_config", lambda: {"model": {"context_length": 100000}})
    db = SessionDB(db_path=tmp_path / "state.db")
    with patch("run_agent.get_tool_definitions", return_value=[]), patch("run_agent.check_toolset_requirements", return_value={}), patch("run_agent.OpenAI"):
        agent = AIAgent(api_key="test-key", base_url="http://127.0.0.1:1/v1", model="test/model",
            enabled_toolsets=[], quiet_mode=True, skip_memory=True, skip_context_files=True,
            session_db=db, session_id="idle-test")
    agent._compression_feasibility_checked = True
    agent.compression_in_place = in_place
    agent.compression_enabled = True
    agent._cached_system_prompt = "Answer the latest question."
    compressor = agent.context_compressor
    compressor.protect_first_n = 0
    compressor.protect_last_n = 2
    compressor.tail_token_budget = 200
    compressor.threshold_tokens = 10000
    compressor.last_prompt_tokens = 9800
    compressor.last_completion_tokens = 100
    monkeypatch.setattr(compressor, "_generate_summary", lambda *a, **k: "Earlier tasks were completed.")
    monkeypatch.setattr(idle_compaction, "estimate_request_tokens_rough", lambda *a, **k: 9900)
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i} " + "context " * 1000} for i in range(12)]
    history += [{"role": "user", "content": "Latest question"}, {"role": "assistant", "content": "Latest reply"}]
    agent._flush_messages_to_session_db(history, [])
    session = make_session(agent)
    session["history"] = history
    try:
        assert idle_compaction.compact_completed_turn(session)
        assert len(session["history"]) < len(history)
        assert session["history"][-1]["content"] == "Latest reply"
        persisted = db.get_messages_as_conversation(agent.session_id)
        assert persisted[-1]["content"] == "Latest reply"
        assert any("Earlier tasks were completed" in str(m.get("content")) for m in persisted)
        agent._flush_messages_to_session_db(agent._session_messages, None)
        assert db.get_messages_as_conversation(agent.session_id) == persisted
        assert idle_compaction.compact_completed_turn(session) is False
    finally:
        db.close()


@pytest.mark.parametrize("terminal_type", ["turn.end", "turn.error"])
def test_isolated_host_releases_maintenance_only_after_turn_end(runtime, monkeypatch, terminal_type):
    session = make_session(SimpleNamespace())
    monkeypatch.setitem(server._sessions, "idle", session)
    forwarded = []
    monkeypatch.setattr(server, "write_json", forwarded.append)
    monkeypatch.setattr(server, "_apply_compute_host_metadata_mirror", lambda *a: None)
    for running in (True, False):
        server._forward_compute_host_rpc({"method": "event", "params": {
            "session_id": "idle", "type": "session.maintenance",
            "payload": {"running": running, "turn_id": "turn"}}})
    assert session["_post_turn_maintenance"] is True
    assert len(forwarded) == 1
    server._on_compute_host_turn_done("r", "idle", session, {"type": terminal_type}, "turn")
    assert session["running"] is False
    assert not session["_post_turn_maintenance"]
    assert ("session.maintenance", {"running": False, "turn_id": "turn"}) in runtime
    assert not [event for event in runtime if event[0] == "message.complete"]
