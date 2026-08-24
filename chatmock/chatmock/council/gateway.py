from __future__ import annotations

"""Flask-facing adapter that puts the Council Runtime behind the existing
/v1/chat/completions route without changing its request/response contract.

Response shape is the standard OpenAI chat completion, extended with:
  - councilRunId: id of the persisted CouncilRun
  - councilMode:  which council mode handled the request
  - council:      full diagnostics, only when includeCouncilDiagnostics=true
"""

import json
import hmac
import re
import time
from typing import Any, Dict, Iterator, List, Optional, Tuple

from flask import Response, current_app, jsonify, make_response

from ..ask import chatmock_ask, get_council_runtime
from ..http import build_cors_headers
from ..model_registry import normalize_model_name
from ..providers.registry import resolve_model
from ..reasoning import request_reasoning_overrides
from .policy import choose_council_mode, council_enabled
from .request_receipts import (
    CouncilReceiptConflict,
    StrictCouncilReceiptStore,
    council_request_hash_v1,
    default_receipt_store,
    safe_result_from_run,
    valid_request_hash,
    valid_request_id,
)
from .types import CouncilInput, CouncilRun, CouncilTokenUsage

_STREAM_CHUNK_CHARS = 4000


def _payload_flag(payload: Dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in payload:
            return payload[name]
    return None


ReceiptBinding = Tuple[str, str, StrictCouncilReceiptStore]


def _strict_alias_value(
    payload: Dict[str, Any],
    camel_name: str,
    snake_name: str,
) -> Tuple[Any, bool]:
    """Return one alias value while rejecting two different spellings.

    Recovery identifiers are part of the dispatch fence, so normal
    first-spelling-wins parsing is unsafe here: a proxy or caller could supply
    both spellings with different values and make different layers bind the
    same provider request to different receipts.
    """
    camel_present = camel_name in payload
    snake_present = snake_name in payload
    if camel_present and snake_present:
        camel_value = payload[camel_name]
        snake_value = payload[snake_name]
        if type(camel_value) is not type(snake_value) or camel_value != snake_value:
            raise ValueError(
                f"Conflicting recoverable Council aliases: {camel_name}/{snake_name}."
            )
    if camel_present:
        return payload[camel_name], True
    if snake_present:
        return payload[snake_name], True
    return None, False


def recoverable_council_binding_values(
    payload: Dict[str, Any],
) -> Tuple[Optional[Tuple[str, str]], Optional[Response]]:
    try:
        client_request_id, has_id = _strict_alias_value(
            payload,
            "clientRequestId",
            "client_request_id",
        )
        client_request_hash, has_hash = _strict_alias_value(
            payload,
            "clientRequestHash",
            "client_request_hash",
        )
    except ValueError as exc:
        return None, _error_response(str(exc), status=400)

    if not has_id and not has_hash:
        return None, None
    if (
        not has_id
        or not has_hash
        or not valid_request_id(client_request_id)
        or not valid_request_hash(client_request_hash)
    ):
        return None, _error_response(
            "Invalid recoverable Council request binding.",
            status=400,
        )
    return (client_request_id, client_request_hash), None


def recoverable_council_passthrough_guard(
    payload: Dict[str, Any],
) -> Optional[Response]:
    """Reject a recoverable binding before an unfenced provider passthrough.

    External Responses providers are selected before the Council adapter runs,
    so the route calls this guard explicitly. It deliberately shares the exact
    alias/conflict parser used by both Council entrypoints.
    """
    binding, binding_error = recoverable_council_binding_values(payload)
    if binding_error is not None:
        return binding_error
    if binding is None:
        return None
    return _error_response(
        "Recoverable Council requests cannot bypass Council routing.",
        status=409,
    )


def _reserve_recoverable_request(
    council_input: CouncilInput,
    requested_binding: Optional[Tuple[str, str]],
) -> Tuple[Optional[ReceiptBinding], Optional[Response]]:
    if requested_binding is None:
        return None, None

    client_request_id, client_request_hash = requested_binding
    try:
        effective_mode = choose_council_mode(
            council_input,
            get_council_runtime().config,
        )
        server_hash = council_request_hash_v1(
            council_input,
            effective_mode=effective_mode,
        )
    except Exception:
        return None, _error_response(
            "Recoverable Council request could not be canonically bound.",
            status=400,
        )
    if not hmac.compare_digest(server_hash, client_request_hash):
        return None, _error_response(
            "Recoverable Council request hash does not match the effective request.",
            status=409,
        )

    try:
        store = default_receipt_store()
        # This strict exclusive-create is the dispatch fence. No provider call
        # is reachable unless the started receipt is durable.
        store.reserve(client_request_id, server_hash)
    except CouncilReceiptConflict:
        return None, _error_response(
            "Recoverable Council request id/hash is already in use.",
            status=409,
        )
    except Exception:
        return None, _error_response(
            "Recoverable Council request receipt could not be persisted.",
            status=500,
        )
    return (client_request_id, server_hash, store), None


def _request_reasoning(
    payload: Dict[str, Any],
    requested_model: Optional[str],
) -> Tuple[Optional[str], Optional[str]]:
    """Read the same request-level reasoning overrides as non-Council routes."""
    overrides = request_reasoning_overrides(payload, requested_model) or {}
    effort = overrides.get("effort")
    summary = overrides.get("summary")
    return (
        effort.strip().lower() if isinstance(effort, str) and effort.strip() else None,
        summary.strip().lower() if isinstance(summary, str) and summary.strip() else None,
    )


def _non_text_content_part(messages: List[Dict[str, Any]]) -> Optional[str]:
    """Name the first content part the council cannot carry, or None.

    The council reasons over flattened text (`types.message_text`), which turns
    an image part into the literal string "[image attachment]": every candidate
    model answers as if nothing were attached, and the user gets a confident
    "I can't see the image" back. So a message carrying anything that isn't
    text belongs on the raw passthrough, which forwards the part upstream
    intact. The Responses path already bypasses for the same reason — see
    `_responses_input_to_messages`.
    """
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict):
                return "unknown"
            part_type = part.get("type")
            if part_type in _TEXT_PART_TYPES and isinstance(part.get("text"), str):
                continue
            return str(part_type or "unknown")
    return None


def council_bypass_reason(payload: Dict[str, Any], messages: List[Dict[str, Any]]) -> Optional[str]:
    """Council handles normal chat requests. Tool-calling and explicit opt-out
    requests keep the legacy passthrough so existing behavior never breaks."""
    if not council_enabled():
        return "council disabled via ENABLE_COUNCIL"
    if payload.get("council") is False:
        return "explicit council=false"
    if payload.get("tools"):
        return "function/tool calling request"
    if payload.get("responses_tools"):
        return "responses_tools request"
    if isinstance(payload.get("tool_choice"), dict):
        return "explicit tool_choice"
    if not messages:
        return "no messages"
    non_text = _non_text_content_part(messages)
    if non_text is not None:
        return f"non-text content part ({non_text})"
    return None


def _build_council_input(
    payload: Dict[str, Any],
    messages: List[Dict[str, Any]],
    requested_model: Optional[str],
    normalized_model: str,
    requested_model_alias: Optional[str] = None,
) -> CouncilInput:
    temperature = payload.get("temperature")
    max_tokens = payload.get("max_tokens") or payload.get("max_completion_tokens")
    reasoning_effort, reasoning_summary = _request_reasoning(payload, requested_model)
    return CouncilInput(
        messages=messages,
        task_type=_payload_flag(payload, "taskType", "task_type"),
        council_mode_override=_payload_flag(payload, "councilModeOverride", "council_mode_override"),
        garden_id=_payload_flag(payload, "gardenId", "garden_id"),
        page_id=_payload_flag(payload, "pageId", "page_id"),
        source_context=_payload_flag(payload, "sourceContext", "source_context"),
        include_diagnostics=bool(_payload_flag(payload, "includeCouncilDiagnostics", "include_council_diagnostics")),
        requested_model_alias=requested_model_alias,
        resolved_model=requested_model or normalized_model,
        requested_model=requested_model or normalized_model,
        temperature=temperature if isinstance(temperature, (int, float)) else None,
        max_tokens=max_tokens if isinstance(max_tokens, int) else None,
        reasoning_effort=reasoning_effort,
        reasoning_summary=reasoning_summary,
    )


def _resolved_usage(run: CouncilRun) -> Tuple[CouncilTokenUsage, bool]:
    reported = run.token_usage_snapshot()
    if reported.fully_reported:
        return reported, False

    # Compatibility fallback for mocked, failed, or older upstream calls that
    # did not include response.completed.response.usage.
    prompt_chars = sum(len(str(m.get("content", ""))) for m in run.messages if isinstance(m, dict))
    completion_chars = len(run.final_answer or "")
    prompt_tokens = max(1, prompt_chars // 4)
    completion_tokens = max(1, completion_chars // 4)
    # Never throw away authoritative subtotals from the calls that did report
    # usage. The outer request estimate is only a floor for missing calls and
    # remains explicitly marked as estimated by every public response shape.
    resolved_input = max(reported.input_tokens, prompt_tokens)
    resolved_output = max(reported.output_tokens, completion_tokens)
    return (
        CouncilTokenUsage(
            input_tokens=resolved_input,
            output_tokens=resolved_output,
            total_tokens=max(reported.total_tokens, resolved_input + resolved_output),
            cached_input_tokens=reported.cached_input_tokens,
            reasoning_tokens=reported.reasoning_tokens,
            call_count=reported.call_count,
            reported_call_count=reported.reported_call_count,
        ),
        True,
    )


def _finalize_recoverable_result(
    run: CouncilRun,
    receipt_binding: Optional[ReceiptBinding],
) -> Optional[Response]:
    if receipt_binding is None:
        return None

    receipt_id, receipt_hash, store = receipt_binding
    try:
        if not (run.final_answer or "").strip():
            store.fail(
                receipt_id,
                receipt_hash,
                "council_no_final_answer",
            )
        else:
            persisted_result = safe_result_from_run(run)
            persisted_usage, persisted_usage_estimated = _resolved_usage(run)
            persisted_result["usage"] = {
                "inputTokens": persisted_usage.input_tokens,
                "outputTokens": persisted_usage.output_tokens,
                "totalTokens": persisted_usage.total_tokens,
                "cachedInputTokens": persisted_usage.cached_input_tokens,
                "reasoningTokens": persisted_usage.reasoning_tokens,
                "callCount": persisted_usage.call_count,
                "reportedCallCount": persisted_usage.reported_call_count,
            }
            persisted_result["usageEstimated"] = persisted_usage_estimated
            store.complete(
                receipt_id,
                receipt_hash,
                persisted_result,
            )
    except Exception:
        return _error_response(
            "Council result completed but its durable recovery receipt could not be finalized.",
            run,
            status=500,
        )
    return None


def _chat_completions_usage(usage: CouncilTokenUsage) -> Dict[str, Any]:
    return {
        "prompt_tokens": usage.input_tokens,
        "completion_tokens": usage.output_tokens,
        "total_tokens": usage.total_tokens,
        "prompt_tokens_details": {"cached_tokens": usage.cached_input_tokens},
        "completion_tokens_details": {"reasoning_tokens": usage.reasoning_tokens},
    }


def _with_cors(resp: Response) -> Response:
    for key, value in build_cors_headers().items():
        resp.headers.setdefault(key, value)
    return resp


def _model_routing_summary(run: CouncilRun) -> Dict[str, Any]:
    attempts = run.model_attempts_snapshot()
    served: List[str] = []
    for attempt in attempts:
        if attempt.get("outcome") != "succeeded":
            continue
        model = attempt.get("resolvedModel")
        if isinstance(model, str) and model not in served:
            served.append(model)
    return {
        "requestedModel": run.requested_model,
        "resolvedModel": run.resolved_model,
        "servedModels": served,
        "usedFallback": any(
            attempt.get("fallback") is True
            and attempt.get("outcome") == "succeeded"
            for attempt in attempts
        ),
    }


def _with_model_routing(resp: Response, run: CouncilRun) -> Response:
    summary = _model_routing_summary(run)
    if isinstance(summary.get("requestedModel"), str):
        resp.headers["X-ChatMock-Requested-Model"] = summary["requestedModel"]
    if isinstance(summary.get("resolvedModel"), str):
        resp.headers["X-ChatMock-Resolved-Model"] = summary["resolvedModel"]
    resp.headers["X-ChatMock-Failover"] = (
        "true" if summary["usedFallback"] else "false"
    )
    return resp


def _run_diagnostic_strings(run: CouncilRun) -> List[str]:
    values: List[str] = []
    for key in ("error", "candidateFailures", "reviewFailures", "synthesisFailure"):
        value = run.diagnostics.get(key)
        if isinstance(value, str):
            values.append(value)
        elif isinstance(value, list):
            values.extend(str(item) for item in value if item)
    return values


def _empty_final_answer_message(run: CouncilRun) -> str:
    diagnostics = "\n".join(_run_diagnostic_strings(run))
    if re.search(r"\bHTTP\s+429\b", diagnostics, flags=re.IGNORECASE):
        match = re.search(r"\bfor\s+([A-Za-z0-9_.:-]+)", diagnostics)
        model = f" for {match.group(1)}" if match else ""
        return (
            f"The council could not produce an answer because ChatGPT returned HTTP 429{model}. "
            "This is usually a usage or rate-limit issue; try again after the limit resets or choose another model."
        )
    if re.search(
        r"\b(?:read|connect)?\s*timeout\b|\btimed\s+out\b",
        diagnostics,
        flags=re.IGNORECASE,
    ):
        return (
            "The council could not produce an answer because the ChatGPT upstream timed out "
            "before the response completed. Please try the request again."
        )
    if re.search(
        r"\bHTTP\s+(?:502|503|504)\b|\bupstream unavailable\b|"
        r"\bwebsocket closed before completion\b|\bconnection_closed\b",
        diagnostics,
        flags=re.IGNORECASE,
    ):
        return (
            "The council could not produce an answer because the ChatGPT upstream was "
            "temporarily unavailable. Please try the request again."
        )
    # A refusal naming the account, not the request: every model fails the same
    # way until someone signs in with an account that has Codex access, so say
    # that rather than blaming the candidates.
    if re.search(
        r"\bnot supported when using Codex with a ChatGPT account\b",
        diagnostics,
        flags=re.IGNORECASE,
    ):
        return (
            "The council could not produce an answer because the signed-in ChatGPT "
            "account cannot serve these models. Switch to an account with Codex "
            "access in Settings, or choose a model from another provider."
        )
    return "The council could not produce an answer because all candidate models failed."


def _error_response(message: str, run: Optional[CouncilRun] = None, status: int = 502) -> Response:
    body: Dict[str, Any] = {"error": {"message": message}}
    if run is not None:
        body["councilRunId"] = run.id
        body["councilMode"] = run.council_mode
    return _with_cors(make_response(jsonify(body), status))


def _sse_iter(
    run: CouncilRun,
    model_name: str,
    created: int,
    include_usage: bool,
) -> Iterator[str]:
    def _chunk(delta: Dict[str, Any], finish_reason: Optional[str]) -> str:
        event = {
            "id": run.id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model_name,
            "councilRunId": run.id,
            "councilMode": run.council_mode,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
        }
        return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    yield _chunk({"role": "assistant"}, None)
    reasoning = run.reasoning_summary or ""
    for start in range(0, len(reasoning), _STREAM_CHUNK_CHARS):
        reasoning_delta = reasoning[start : start + _STREAM_CHUNK_CHARS]
        yield _chunk(
            {
                "reasoning_content": reasoning_delta,
                "reasoning_summary": reasoning_delta,
                "reasoning": reasoning_delta,
            },
            None,
        )
    text = run.final_answer or ""
    for start in range(0, len(text), _STREAM_CHUNK_CHARS):
        yield _chunk({"content": text[start : start + _STREAM_CHUNK_CHARS]}, None)
    yield _chunk({}, "stop")
    if include_usage:
        usage, usage_estimated = _resolved_usage(run)
        usage_event = {
            "id": run.id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model_name,
            "councilRunId": run.id,
            "councilMode": run.council_mode,
            "choices": [],
            "usage": _chat_completions_usage(usage),
            "usageEstimated": usage_estimated,
        }
        yield f"data: {json.dumps(usage_event, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"


def maybe_handle_with_council(
    payload: Dict[str, Any],
    messages: List[Dict[str, Any]],
    *,
    requested_model: Optional[str],
    model: str,
    requested_model_alias: Optional[str] = None,
    strict_model_route: bool = False,
    verbose: bool = False,
) -> Optional[Response]:
    """Returns a Flask response when the council handled the request, or None
    to let the legacy passthrough continue."""
    requested_binding, binding_error = recoverable_council_binding_values(payload)
    if binding_error is not None:
        return binding_error

    bypass = council_bypass_reason(payload, messages)
    if bypass is not None:
        if requested_binding is not None:
            # A recoverable request may never fall through to a provider path
            # that lacks the strict pre-dispatch receipt fence.
            return _error_response(
                "Recoverable Council requests cannot bypass Council routing.",
                status=409,
            )
        if verbose:
            print(f"[Council] bypass: {bypass}")
        return None

    council_input = _build_council_input(
        payload,
        messages,
        requested_model,
        model,
        requested_model_alias,
    )
    council_input.strict_model_route = requested_binding is not None or strict_model_route
    receipt_binding, reserve_error = _reserve_recoverable_request(
        council_input,
        requested_binding,
    )
    if reserve_error is not None:
        return reserve_error
    run = chatmock_ask(council_input)

    finalize_error = _finalize_recoverable_result(run, receipt_binding)
    if finalize_error is not None:
        return finalize_error

    if verbose:
        print(f"[Council] run {run.id} mode={run.council_mode} taskType={run.task_type or '-'}")

    if not (run.final_answer or "").strip():
        # Never leak raw provider errors to the frontend.
        return _error_response(
            _empty_final_answer_message(run),
            run,
        )

    created = int(time.time())
    model_name = requested_model or model

    if bool(payload.get("stream")):
        stream_options = payload.get("stream_options") if isinstance(payload.get("stream_options"), dict) else {}
        include_usage = bool(stream_options.get("include_usage", False))
        resp = Response(
            _sse_iter(run, model_name, created, include_usage),
            status=200,
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
        return _with_model_routing(_with_cors(resp), run)

    usage, usage_estimated = _resolved_usage(run)
    completion: Dict[str, Any] = {
        "id": run.id,
        "object": "chat.completion",
        "created": created,
        "model": model_name,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": run.final_answer,
                    **(
                        {
                            "reasoning_content": run.reasoning_summary,
                            "reasoning_summary": run.reasoning_summary,
                            "reasoning": run.reasoning_summary,
                        }
                        if run.reasoning_summary
                        else {}
                    ),
                },
                "finish_reason": "stop",
            }
        ],
        "usage": _chat_completions_usage(usage),
        "usageEstimated": usage_estimated,
        "councilRunId": run.id,
        "councilMode": run.council_mode,
        "chatmockModelRouting": _model_routing_summary(run),
    }
    if council_input.include_diagnostics:
        completion["council"] = run.diagnostics_dict()
    return _with_model_routing(
        _with_cors(make_response(jsonify(completion), 200)),
        run,
    )


# ---------------------------------------------------------------------------
# /v1/responses adapter
# ---------------------------------------------------------------------------

# Council routing fields carried in the request body. They are popped off the
# /v1/responses payload before it can be forwarded upstream, because that
# route forwards the payload wholesale.
_COUNCIL_FIELD_NAMES = (
    "taskType",
    "task_type",
    "councilModeOverride",
    "council_mode_override",
    "gardenId",
    "garden_id",
    "pageId",
    "page_id",
    "sourceContext",
    "source_context",
    "includeCouncilDiagnostics",
    "include_council_diagnostics",
    "clientRequestId",
    "client_request_id",
    "clientRequestHash",
    "client_request_hash",
    "council",
)

_TEXT_PART_TYPES = ("input_text", "output_text", "text", "summary_text")


def extract_council_fields(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Removes council fields from the payload and returns them."""
    fields: Dict[str, Any] = {}
    for name in _COUNCIL_FIELD_NAMES:
        if name in payload:
            fields[name] = payload.pop(name)
    return fields


def _field(fields: Dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in fields:
            return fields[name]
    return None


def _responses_input_to_messages(
    payload: Dict[str, Any],
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """Converts a text-only Responses API request into chat messages.
    Returns (messages, None) on success or (None, bypass_reason)."""
    messages: List[Dict[str, Any]] = []
    instructions = payload.get("instructions")
    if isinstance(instructions, str) and instructions.strip():
        messages.append({"role": "system", "content": instructions})

    raw_input = payload.get("input")
    if isinstance(raw_input, str):
        if not raw_input.strip():
            return None, "empty input"
        messages.append({"role": "user", "content": raw_input})
        return messages, None
    if not isinstance(raw_input, list):
        return None, "unsupported input shape"

    for item in raw_input:
        if not isinstance(item, dict):
            return None, "unsupported input item"
        item_type = item.get("type", "message")
        if item_type != "message":
            return None, f"non-message input item ({item_type})"
        role = item.get("role") if isinstance(item.get("role"), str) else "user"
        content = item.get("content")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            parts: List[str] = []
            for part in content:
                if not isinstance(part, dict):
                    return None, "unsupported content part"
                part_type = part.get("type")
                if part_type in _TEXT_PART_TYPES and isinstance(part.get("text"), str):
                    parts.append(part["text"])
                else:
                    # input_image, input_file, refusal, ... need the raw upstream.
                    return None, f"non-text content part ({part_type})"
            text = "\n".join(parts)
        else:
            return None, "unsupported content shape"
        messages.append({"role": role, "content": text})

    if not any(m.get("role") == "user" for m in messages):
        return None, "no user message in input"
    return messages, None


def _responses_bypass_reason(payload: Dict[str, Any], fields: Dict[str, Any]) -> Optional[str]:
    if not council_enabled():
        return "council disabled via ENABLE_COUNCIL"
    if fields.get("council") is False:
        return "explicit council=false"
    if payload.get("tools"):
        return "tools requested"
    if isinstance(payload.get("tool_choice"), dict):
        return "explicit tool_choice"
    if payload.get("previous_response_id"):
        return "session continuation (previous_response_id)"
    try:
        default_web_search = bool(current_app.config.get("DEFAULT_WEB_SEARCH"))
    except Exception:
        default_web_search = False
    if default_web_search:
        tool_choice = payload.get("tool_choice")
        if not (isinstance(tool_choice, str) and tool_choice.strip().lower() == "none"):
            return "server default web search enabled"
    return None


def _responses_usage(usage: CouncilTokenUsage) -> Dict[str, Any]:
    return {
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "total_tokens": usage.total_tokens,
        "input_tokens_details": {"cached_tokens": usage.cached_input_tokens},
        "output_tokens_details": {"reasoning_tokens": usage.reasoning_tokens},
    }


def _responses_message_item(run: CouncilRun) -> Dict[str, Any]:
    return {
        "id": f"{run.id}-msg",
        "type": "message",
        "role": "assistant",
        "status": "completed",
        "content": [{"type": "output_text", "text": run.final_answer or "", "annotations": []}],
    }


def _responses_reasoning_item(run: CouncilRun) -> Optional[Dict[str, Any]]:
    if not run.reasoning_summary:
        return None
    return {
        "id": f"{run.id}-reasoning",
        "type": "reasoning",
        "status": "completed",
        "summary": [{"type": "summary_text", "text": run.reasoning_summary}],
    }


def _responses_object(run: CouncilRun, model_name: str, created: int, include_diagnostics: bool) -> Dict[str, Any]:
    usage, usage_estimated = _resolved_usage(run)
    body: Dict[str, Any] = {
        "id": run.id,
        "object": "response",
        "created_at": created,
        "status": "completed",
        "model": model_name,
        "output": [
            *([_responses_reasoning_item(run)] if run.reasoning_summary else []),
            _responses_message_item(run),
        ],
        "usage": _responses_usage(usage),
        "usageEstimated": usage_estimated,
        "metadata": {
            "councilRunId": run.id,
            "councilMode": run.council_mode,
            "chatmockModelRouting": _model_routing_summary(run),
        },
        "councilRunId": run.id,
        "councilMode": run.council_mode,
    }
    if include_diagnostics:
        body["council"] = run.diagnostics_dict()
    return body


def _responses_sse_iter(run: CouncilRun, model_name: str, created: int) -> Iterator[str]:
    def _event(payload: Dict[str, Any]) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    message_item = _responses_message_item(run)
    in_progress = {
        "id": run.id,
        "object": "response",
        "created_at": created,
        "status": "in_progress",
        "model": model_name,
        "output": [],
        "metadata": {"councilRunId": run.id, "councilMode": run.council_mode},
    }
    yield _event({"type": "response.created", "response": in_progress})
    reasoning_item = _responses_reasoning_item(run)
    output_index = 0
    if reasoning_item is not None:
        yield _event(
            {
                "type": "response.output_item.added",
                "output_index": 0,
                "item": {**reasoning_item, "status": "in_progress", "summary": []},
            }
        )
        yield _event(
            {
                "type": "response.reasoning_summary_part.added",
                "item_id": reasoning_item["id"],
                "output_index": 0,
                "summary_index": 0,
                "part": {"type": "summary_text", "text": ""},
            }
        )
        for start in range(0, len(run.reasoning_summary), _STREAM_CHUNK_CHARS):
            yield _event(
                {
                    "type": "response.reasoning_summary_text.delta",
                    "item_id": reasoning_item["id"],
                    "output_index": 0,
                    "summary_index": 0,
                    "delta": run.reasoning_summary[start : start + _STREAM_CHUNK_CHARS],
                }
            )
        yield _event(
            {
                "type": "response.reasoning_summary_text.done",
                "item_id": reasoning_item["id"],
                "output_index": 0,
                "summary_index": 0,
                "text": run.reasoning_summary,
            }
        )
        yield _event(
            {
                "type": "response.reasoning_summary_part.done",
                "item_id": reasoning_item["id"],
                "output_index": 0,
                "summary_index": 0,
                "part": {"type": "summary_text", "text": run.reasoning_summary},
            }
        )
        yield _event(
            {"type": "response.output_item.done", "output_index": 0, "item": reasoning_item}
        )
        output_index = 1
    yield _event(
        {
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": {**message_item, "status": "in_progress", "content": []},
        }
    )
    text = run.final_answer or ""
    for start in range(0, len(text), _STREAM_CHUNK_CHARS):
        yield _event(
            {
                "type": "response.output_text.delta",
                "item_id": message_item["id"],
                "output_index": output_index,
                "content_index": 0,
                "delta": text[start : start + _STREAM_CHUNK_CHARS],
            }
        )
    yield _event(
        {"type": "response.output_item.done", "output_index": output_index, "item": message_item}
    )
    yield _event(
        {
            "type": "response.completed",
            "response": _responses_object(run, model_name, created, include_diagnostics=False),
        }
    )
    yield "data: [DONE]\n\n"


def maybe_handle_responses_with_council(
    payload: Dict[str, Any],
    *,
    verbose: bool = False,
) -> Optional[Response]:
    """Council adapter for /v1/responses. Always strips council routing fields
    from the payload (the legacy path forwards it wholesale); returns a Flask
    response when the request is text-only and safely council-mediated, or
    None to fall through to the legacy passthrough."""
    fields = extract_council_fields(payload)
    requested_binding, binding_error = recoverable_council_binding_values(fields)
    if binding_error is not None:
        return binding_error

    bypass = _responses_bypass_reason(payload, fields)
    if bypass is None:
        messages, convert_error = _responses_input_to_messages(payload)
        if convert_error is not None:
            bypass = convert_error
    if bypass is not None:
        if requested_binding is not None:
            # The raw Responses passthrough has no strict receipt boundary.
            return _error_response(
                "Recoverable Council requests cannot bypass Council routing.",
                status=409,
            )
        if verbose:
            print(f"[Council] bypass responses: {bypass}")
        return None

    requested_model_alias = payload.get("model") if isinstance(payload.get("model"), str) else None
    try:
        debug_model = current_app.config.get("DEBUG_MODEL")
    except Exception:
        debug_model = None
    resolved = resolve_model(requested_model_alias)
    routed_model = normalize_model_name(resolved.upstream_model, debug_model)
    model_name = resolved.public_model if routed_model == resolved.upstream_model else routed_model

    temperature = payload.get("temperature")
    max_tokens = payload.get("max_output_tokens")
    reasoning_effort, reasoning_summary = _request_reasoning(payload, requested_model_alias)
    council_input = CouncilInput(
        messages=messages,
        task_type=_field(fields, "taskType", "task_type"),
        council_mode_override=_field(fields, "councilModeOverride", "council_mode_override"),
        garden_id=_field(fields, "gardenId", "garden_id"),
        page_id=_field(fields, "pageId", "page_id"),
        source_context=_field(fields, "sourceContext", "source_context"),
        include_diagnostics=bool(_field(fields, "includeCouncilDiagnostics", "include_council_diagnostics")),
        requested_model_alias=requested_model_alias,
        resolved_model=model_name,
        requested_model=routed_model,
        temperature=temperature if isinstance(temperature, (int, float)) else None,
        max_tokens=max_tokens if isinstance(max_tokens, int) else None,
        reasoning_effort=reasoning_effort,
        reasoning_summary=reasoning_summary,
        strict_model_route=requested_binding is not None,
    )
    receipt_binding, reserve_error = _reserve_recoverable_request(
        council_input,
        requested_binding,
    )
    if reserve_error is not None:
        return reserve_error
    run = chatmock_ask(council_input)

    finalize_error = _finalize_recoverable_result(run, receipt_binding)
    if finalize_error is not None:
        return finalize_error

    if verbose:
        print(f"[Council] run {run.id} mode={run.council_mode} taskType={run.task_type or '-'} (responses)")

    if not (run.final_answer or "").strip():
        return _error_response(
            _empty_final_answer_message(run),
            run,
        )

    created = int(time.time())
    if bool(payload.get("stream")):
        resp = Response(
            _responses_sse_iter(run, model_name, created),
            status=200,
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
        return _with_model_routing(_with_cors(resp), run)

    body = _responses_object(run, model_name, created, council_input.include_diagnostics)
    return _with_model_routing(
        _with_cors(make_response(jsonify(body), 200)),
        run,
    )
