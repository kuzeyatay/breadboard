from __future__ import annotations

"""Flask-facing adapter that puts the Council Runtime behind the existing
/v1/chat/completions route without changing its request/response contract.

Response shape is the standard OpenAI chat completion, extended with:
  - councilRunId: id of the persisted CouncilRun
  - councilMode:  which council mode handled the request
  - council:      full diagnostics, only when includeCouncilDiagnostics=true
"""

import json
import re
import time
from typing import Any, Dict, Iterator, List, Optional, Tuple

from flask import Response, current_app, jsonify, make_response

from ..ask import chatmock_ask
from ..http import build_cors_headers
from ..model_registry import normalize_model_name
from .policy import council_enabled
from .types import CouncilInput, CouncilRun

_STREAM_CHUNK_CHARS = 4000


def _payload_flag(payload: Dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in payload:
            return payload[name]
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
    return None


def _build_council_input(
    payload: Dict[str, Any],
    messages: List[Dict[str, Any]],
    requested_model: Optional[str],
    normalized_model: str,
) -> CouncilInput:
    temperature = payload.get("temperature")
    max_tokens = payload.get("max_tokens") or payload.get("max_completion_tokens")
    return CouncilInput(
        messages=messages,
        task_type=_payload_flag(payload, "taskType", "task_type"),
        council_mode_override=_payload_flag(payload, "councilModeOverride", "council_mode_override"),
        garden_id=_payload_flag(payload, "gardenId", "garden_id"),
        page_id=_payload_flag(payload, "pageId", "page_id"),
        source_context=_payload_flag(payload, "sourceContext", "source_context"),
        include_diagnostics=bool(_payload_flag(payload, "includeCouncilDiagnostics", "include_council_diagnostics")),
        requested_model=requested_model or normalized_model,
        temperature=temperature if isinstance(temperature, (int, float)) else None,
        max_tokens=max_tokens if isinstance(max_tokens, int) else None,
    )


def _estimated_usage(run: CouncilRun) -> Dict[str, int]:
    prompt_chars = sum(len(str(m.get("content", ""))) for m in run.messages if isinstance(m, dict))
    completion_chars = len(run.final_answer or "")
    prompt_tokens = max(1, prompt_chars // 4)
    completion_tokens = max(1, completion_chars // 4)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }


def _with_cors(resp: Response) -> Response:
    for key, value in build_cors_headers().items():
        resp.headers.setdefault(key, value)
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
    text = run.final_answer or ""
    for start in range(0, len(text), _STREAM_CHUNK_CHARS):
        yield _chunk({"content": text[start : start + _STREAM_CHUNK_CHARS]}, None)
    yield _chunk({}, "stop")
    if include_usage:
        usage_event = {
            "id": run.id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model_name,
            "councilRunId": run.id,
            "councilMode": run.council_mode,
            "choices": [],
            "usage": _estimated_usage(run),
        }
        yield f"data: {json.dumps(usage_event, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"


def maybe_handle_with_council(
    payload: Dict[str, Any],
    messages: List[Dict[str, Any]],
    *,
    requested_model: Optional[str],
    model: str,
    verbose: bool = False,
) -> Optional[Response]:
    """Returns a Flask response when the council handled the request, or None
    to let the legacy passthrough continue."""
    bypass = council_bypass_reason(payload, messages)
    if bypass is not None:
        if verbose:
            print(f"[Council] bypass: {bypass}")
        return None

    council_input = _build_council_input(payload, messages, requested_model, model)
    run = chatmock_ask(council_input)

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
        return _with_cors(resp)

    completion: Dict[str, Any] = {
        "id": run.id,
        "object": "chat.completion",
        "created": created,
        "model": model_name,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": run.final_answer},
                "finish_reason": "stop",
            }
        ],
        "usage": _estimated_usage(run),
        "councilRunId": run.id,
        "councilMode": run.council_mode,
    }
    if council_input.include_diagnostics:
        completion["council"] = run.diagnostics_dict()
    return _with_cors(make_response(jsonify(completion), 200))


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


def _responses_usage(run: CouncilRun) -> Dict[str, int]:
    usage = _estimated_usage(run)
    return {
        "input_tokens": usage["prompt_tokens"],
        "output_tokens": usage["completion_tokens"],
        "total_tokens": usage["total_tokens"],
    }


def _responses_message_item(run: CouncilRun) -> Dict[str, Any]:
    return {
        "id": f"{run.id}-msg",
        "type": "message",
        "role": "assistant",
        "status": "completed",
        "content": [{"type": "output_text", "text": run.final_answer or "", "annotations": []}],
    }


def _responses_object(run: CouncilRun, model_name: str, created: int, include_diagnostics: bool) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "id": run.id,
        "object": "response",
        "created_at": created,
        "status": "completed",
        "model": model_name,
        "output": [_responses_message_item(run)],
        "usage": _responses_usage(run),
        "metadata": {"councilRunId": run.id, "councilMode": run.council_mode},
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
    yield _event(
        {
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {**message_item, "status": "in_progress", "content": []},
        }
    )
    text = run.final_answer or ""
    for start in range(0, len(text), _STREAM_CHUNK_CHARS):
        yield _event(
            {
                "type": "response.output_text.delta",
                "item_id": message_item["id"],
                "output_index": 0,
                "content_index": 0,
                "delta": text[start : start + _STREAM_CHUNK_CHARS],
            }
        )
    yield _event({"type": "response.output_item.done", "output_index": 0, "item": message_item})
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

    bypass = _responses_bypass_reason(payload, fields)
    if bypass is None:
        messages, convert_error = _responses_input_to_messages(payload)
        if convert_error is not None:
            bypass = convert_error
    if bypass is not None:
        if verbose:
            print(f"[Council] bypass responses: {bypass}")
        return None

    requested_model = payload.get("model") if isinstance(payload.get("model"), str) else None
    try:
        debug_model = current_app.config.get("DEBUG_MODEL")
    except Exception:
        debug_model = None
    model_name = requested_model or normalize_model_name(requested_model, debug_model)

    temperature = payload.get("temperature")
    council_input = CouncilInput(
        messages=messages,
        task_type=_field(fields, "taskType", "task_type"),
        council_mode_override=_field(fields, "councilModeOverride", "council_mode_override"),
        garden_id=_field(fields, "gardenId", "garden_id"),
        page_id=_field(fields, "pageId", "page_id"),
        source_context=_field(fields, "sourceContext", "source_context"),
        include_diagnostics=bool(_field(fields, "includeCouncilDiagnostics", "include_council_diagnostics")),
        requested_model=normalize_model_name(requested_model, debug_model),
        temperature=temperature if isinstance(temperature, (int, float)) else None,
    )
    run = chatmock_ask(council_input)

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
        return _with_cors(resp)

    body = _responses_object(run, model_name, created, council_input.include_diagnostics)
    return _with_cors(make_response(jsonify(body), 200))
