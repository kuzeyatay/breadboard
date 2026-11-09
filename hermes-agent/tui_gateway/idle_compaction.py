"""Prepare the next Breadboard turn while the completed reply is being read."""

from agent.model_metadata import estimate_request_tokens_rough
from agent.conversation_compression import finalize_context_engine_compression_notification


def compact_completed_turn(session: dict) -> bool:
    """Run one automatic pass under the caller's exclusive turn ownership.

    The caller has already delivered message.complete, but keeps running=True
    until this returns. New prompts must queue, never interrupt or mutate this
    agent. The normal preflight remains the fallback for a failed/no-op pass or
    an unexpectedly large next input.
    """
    agent = session.get("agent")
    if not agent or not getattr(agent, "compression_enabled", False):
        return False
    compressor = agent.context_compressor
    if getattr(compressor, "awaiting_real_usage_after_compression", False):
        return False
    if getattr(agent, "api_mode", None) == "codex_app_server" and getattr(
        agent, "codex_app_server_auto_compaction", "native"
    ) != "hermes":
        return False
    with session["history_lock"]:
        if session.get("_turn_cancel_requested") or session.get("_finalized"):
            return False
        history = list(session.get("history", []))
        version = int(session.get("history_version", 0))
    if not history or not compressor.has_content_to_compress(history):
        return False
    rough = estimate_request_tokens_rough(
        history,
        system_prompt=getattr(agent, "_cached_system_prompt", "") or "",
        tools=getattr(agent, "tools", None) or None,
    )
    # Include the reply just produced, plus modest room for the next input.
    # Respect the compressor's calibrated rough-estimate and cooldown guards.
    tokens = max(0, compressor.last_prompt_tokens) + max(0, compressor.last_completion_tokens)
    defer = getattr(compressor, "should_defer_preflight_to_real_usage", lambda _: False)
    if not defer(rough):
        tokens = max(tokens, rough)
    reserve = min(4096, max(0, int(compressor.threshold_tokens * 0.05)))
    if not compressor.should_compress(tokens + reserve):
        return False
    committed = False
    try:
        compressed, _ = agent._compress_context(
            history, None, approx_tokens=tokens, task_id=session["session_key"],
            defer_context_engine_notification=True,
        )
        if compressed is history:
            return False
        if getattr(agent, "_last_compression_attempt_in_place", None) is True:
            # archive_and_compact already inserted these rows. Seed the normal
            # persistence markers before an idle-session shutdown can flush.
            agent._flush_messages_to_session_db(compressed, conversation_history=compressed)
        with session["history_lock"]:
            if int(session.get("history_version", 0)) != version:
                return False
            session["history"] = compressed
            session["history_version"] = version + 1
            # Session teardown flushes this mirror; leaving the old list here
            # would append the pre-compaction history again on close.
            agent._session_messages = compressed
            committed = True
        return True
    finally:
        finalize_context_engine_compression_notification(agent, committed=committed)
