"""Finish delegated work before closing a client-owned runtime turn.

External clients authorize tools against their active turn. Publishing completion
and then starting an uncorrelated notification turn revokes that authorization
under the continuation. Keep the original turn alive, including its usage and
tool journal, until its child results have been consumed.
Exhausted model-call windows resume within that same turn, from saved history.
"""
from __future__ import annotations

import time


DEFAULT_MAX_AUTO_CONTINUATIONS = 8


def auto_continuation_limit(cfg: dict) -> int:
    agent_cfg = cfg.get("agent") or {}
    value = agent_cfg.get("max_auto_continuations", DEFAULT_MAX_AUTO_CONTINUATIONS)
    try:
        if isinstance(value, bool):
            raise ValueError("Expected an integer continuation count")
        return max(0, int(value))
    except (TypeError, ValueError):
        return DEFAULT_MAX_AUTO_CONTINUATIONS


def client_manages_notification(session: dict, event: dict) -> bool:
    return bool(session.get("client_managed_turns")) and event.get("type") == "async_delegation"


def finish_delegations(agent, result, run_kwargs, *, owns_event, cancelled, interim, waiting,
                       max_auto_continuations=DEFAULT_MAX_AUTO_CONTINUATIONS, continuing=None):
    from tools import async_delegation as delegations
    from tools.process_registry import process_registry

    original_limit = getattr(agent, "max_iterations", 90)
    calls_used = 0
    auto_continuations = 0
    announced_wait = False
    retained_answers: list[str] = []

    def preserve_answers(current):
        # A child can arrive after the parent has written the whole answer.
        # Its continuation commonly says only "One addition to the table above".
        # Clients replace their provisional stream with final_response, so keep
        # those answers here rather than relegating them to Thinking. A budget
        # exit describes why the loop stopped, not whether its summary contains
        # the requested deliverable; it must not discard real answer text.
        # Do not rewrite messages: they are the model's cache-stable history.
        if not retained_answers or not isinstance(current, dict):
            return current
        parts = list(retained_answers)
        text = current.get("final_response")
        if isinstance(text, str) and text.strip() and text.strip() != parts[-1]:
            parts.append(text.strip())
        return {**current, "final_response": "\n\n".join(parts)}

    try:
        while isinstance(result, dict):
            calls_used += int(result.get("api_calls") or 0)
            if cancelled():
                return preserve_answers({**result, "interrupted": True, "completed": False})
            if (result.get("interrupted") or result.get("error") or result.get("failed")
                    or result.get("partial") or guardrail_failure(result)):
                return preserve_answers(result)
            history = result.get("messages")
            if not isinstance(history, list):
                return preserve_answers(result)
            # Use the core's structured exit reason, never wording in model
            # output (which may quote a limit message from a source document).
            exit_reason = str(result.get("turn_exit_reason") or "")
            checkpoint = (exit_reason.startswith("max_iterations_reached(")
                          or exit_reason == "budget_exhausted")
            renewed_budget = False

            # The poller may briefly hold a completed event while requeuing it.
            # Check the durable delivery state as well as running children, so
            # that gap cannot prematurely close the externally owned run.
            while True:
                if cancelled():
                    return preserve_answers({**result, "interrupted": True, "completed": False})
                pending = []
                for record in delegations.list_async_delegations():
                    if not owns_event(record):
                        continue
                    durable = delegations.get_durable_delegation(record["delegation_id"])
                    if durable and durable["delivery_state"] in {"delivered", "dropped"}:
                        continue
                    if record.get("status") in {"running", "finalizing"} or (
                        durable and durable["delivery_state"] == "pending"
                    ):
                        pending.append(record)
                if not pending and not checkpoint:
                    return preserve_answers(result)
                if not renewed_budget and (checkpoint or calls_used >= original_limit):
                    if auto_continuations >= max_auto_continuations:
                        explanation = (
                            "The automatic continuation limit was reached after "
                            f"{auto_continuations} restarts. Progress is saved."
                        )
                        preserved = preserve_answers(result)
                        return {**preserved, "completed": False, "error": explanation,
                                "final_response": f"{preserved.get('final_response') or ''}\n\n{explanation}".strip()}
                    auto_continuations += 1
                    calls_used = 0
                    renewed_budget = True
                    if continuing:
                        continuing(auto_continuations)
                if not pending:
                    claimed = []
                    break

                drained = process_registry.drain_notifications(
                    owns_event=lambda e: e.get("type") == "async_delegation" and owns_event(e),
                    skip_poll_observed=False,
                )
                claimed = []
                for event, text in drained:
                    # drain_notifications preserves legacy ownerless process
                    # events. They belong to its ordinary notification path.
                    if event.get("type") != "async_delegation":
                        process_registry.completion_queue.put(event)
                        continue
                    claim = delegations.claim_event_delivery(event, "client-turn")
                    if claim is not None:
                        claimed.append((event, text, claim))
                if claimed:
                    break
                if not announced_wait:
                    waiting()
                    announced_wait = True
                time.sleep(0.1)

            if cancelled():
                for event, _text, claim in claimed:
                    delegations.release_event_delivery(event, claim)
                    process_registry.completion_queue.put(event)
                return preserve_answers({**result, "interrupted": True, "completed": False})
            answer = result.get("final_response")
            if isinstance(answer, str) and answer.strip():
                # The limit-summary call can produce the full requested table
                # or document. Preserve it just like a normal completed answer:
                # later calls can provide only a correction referring back to it.
                if not retained_answers or answer.strip() != retained_answers[-1]:
                    retained_answers.append(answer.strip())
                interim(answer)
            followup = "\n\n".join(text for _event, text, _claim in claimed)
            if renewed_budget:
                followup += (
                    "\n\n[System: The model-call window was renewed automatically. "
                    "Continue the user's original request from the saved conversation "
                    "and existing work. Earlier answer text is retained in the final response. "
                    "Incorporate any delegated results, finish the remaining work, "
                    "verify it, and deliver the requested result. Do not restart "
                    "completed work or ask the user to type continue.]"
                )
            if retained_answers:
                followup += (
                    "\n\n[System: Your response to these background results will be "
                    "appended to the previous answer in the same user-visible message. "
                    "The previous answer is preserved. Give only useful additions or "
                    "explicit corrections; do not repeat the full answer.]"
                )
            if result.get("pending_steer"):
                followup += "\n\nUser follow-up:\n" + result["pending_steer"]
            # run_conversation has its own per-call budget reset. Carry the
            # remaining window across hand-backs. Only explicit window
            # exhaustion grants another budget, bounded above for the turn.
            agent.max_iterations = original_limit - calls_used
            try:
                result = agent.run_conversation(followup, **{**run_kwargs, "conversation_history": history})
            except Exception:
                for event, _text, claim in claimed:
                    delegations.release_event_delivery(event, claim)
                    process_registry.completion_queue.put(event)
                raise
            for event, _text, claim in claimed:
                delegations.complete_event_delivery(event, claim)
            announced_wait = False
        return preserve_answers(result)
    finally:
        agent.max_iterations = original_limit


def guardrail_failure(result: dict) -> tuple[str, str] | None:
    guardrail = result.get("guardrail")
    if not isinstance(guardrail, dict) or guardrail.get("action") not in {"block", "halt"}:
        return None
    code = str(guardrail.get("code") or "tool_guardrail_halt")
    return code, f"Work stopped by the tool-loop guard ({code}). " + str(
        guardrail.get("message") or "The runtime stopped further tool execution."
    )
