from __future__ import annotations

"""Responses API compatibility for ChatMock's chat-completions providers.

Modern Codex only speaks ``/v1/responses``. Subscription and third-party
providers behind ChatMock speak chat completions, so this module translates one
complete model step in each direction. The upstream call is intentionally
non-streaming; when Codex asks for SSE we emit a standards-shaped Responses
event sequence after the provider finishes.
"""

import json
import time
import uuid
from typing import Any, Dict, Iterator, List, Set, Tuple

from flask import Response, jsonify, make_response

from .http import build_cors_headers
from .providers import dispatch as provider_dispatch
from .providers.registry import ResolvedModel


def _string_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: List[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    if value is None:
        return ""
    return json.dumps(value, ensure_ascii=False)


def _message_content(value: Any, *, assistant: bool) -> Any:
    if isinstance(value, str):
        return value
    if not isinstance(value, list):
        return _string_content(value)

    parts: List[Dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = item.get("type")
        if kind in ("input_text", "output_text", "text"):
            text = item.get("text")
            if isinstance(text, str) and text:
                parts.append({"type": "text", "text": text})
        elif kind == "input_image" and not assistant:
            image_url = item.get("image_url")
            if isinstance(image_url, str) and image_url:
                parts.append({"type": "image_url", "image_url": {"url": image_url}})
    if not parts:
        return ""
    if all(part.get("type") == "text" for part in parts):
        return "".join(str(part.get("text") or "") for part in parts)
    return parts


def _call_arguments(item: Dict[str, Any], *, custom: bool) -> str:
    raw = item.get("input") if custom else item.get("arguments")
    if isinstance(raw, str):
        return json.dumps({"input": raw}, ensure_ascii=False) if custom else raw
    if custom:
        return json.dumps({"input": _string_content(raw)}, ensure_ascii=False)
    return json.dumps(raw if isinstance(raw, dict) else {}, ensure_ascii=False)


def _responses_messages(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    messages: List[Dict[str, Any]] = []
    instructions = payload.get("instructions")
    if isinstance(instructions, str) and instructions.strip():
        messages.append({"role": "system", "content": instructions})

    raw_input = payload.get("input")
    if isinstance(raw_input, str):
        return [*messages, {"role": "user", "content": raw_input}]
    items = raw_input if isinstance(raw_input, list) else [raw_input]
    pending_calls: List[Dict[str, Any]] = []

    def flush_calls() -> None:
        if not pending_calls:
            return
        messages.append({"role": "assistant", "content": None, "tool_calls": list(pending_calls)})
        pending_calls.clear()

    for item in items:
        if not isinstance(item, dict):
            continue
        kind = item.get("type")
        if kind in ("function_call", "custom_tool_call"):
            name = item.get("name")
            call_id = item.get("call_id") or item.get("id")
            if isinstance(name, str) and name and isinstance(call_id, str) and call_id:
                pending_calls.append(
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": _call_arguments(item, custom=kind == "custom_tool_call"),
                        },
                    }
                )
            continue

        flush_calls()
        if kind in ("function_call_output", "custom_tool_call_output"):
            call_id = item.get("call_id")
            if isinstance(call_id, str) and call_id:
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": _string_content(item.get("output")),
                    }
                )
            continue
        if kind != "message":
            continue
        role = item.get("role")
        if role not in ("user", "assistant", "system", "developer"):
            role = "user"
        chat_role = "system" if role == "developer" else role
        content = _message_content(item.get("content"), assistant=chat_role == "assistant")
        if content:
            messages.append({"role": chat_role, "content": content})

    flush_calls()
    return messages


def _responses_tools(payload: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Set[str]]:
    tools: List[Dict[str, Any]] = []
    custom_names: Set[str] = set()
    for item in payload.get("tools") if isinstance(payload.get("tools"), list) else []:
        if not isinstance(item, dict):
            continue
        kind = item.get("type")
        name = item.get("name")
        if kind not in ("function", "custom") or not isinstance(name, str) or not name:
            continue
        if kind == "custom":
            custom_names.add(name)
            parameters = {
                "type": "object",
                "properties": {"input": {"type": "string"}},
                "required": ["input"],
                "additionalProperties": False,
            }
        else:
            parameters = item.get("parameters")
            if not isinstance(parameters, dict):
                parameters = {"type": "object", "properties": {}}
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": item.get("description") if isinstance(item.get("description"), str) else "",
                    "parameters": parameters,
                },
            }
        )
    return tools, custom_names


def _chat_tool_choice(value: Any) -> Any:
    if isinstance(value, str):
        return value if value in ("auto", "none", "required") else "auto"
    if isinstance(value, dict) and isinstance(value.get("name"), str):
        return {"type": "function", "function": {"name": value["name"]}}
    return "auto"


def responses_to_chat_payload(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], Set[str]]:
    tools, custom_names = _responses_tools(payload)
    chat: Dict[str, Any] = {
        "messages": _responses_messages(payload),
        # The compatibility layer builds its own Responses SSE stream.
        "stream": False,
    }
    if tools:
        chat["tools"] = tools
        chat["tool_choice"] = _chat_tool_choice(payload.get("tool_choice", "auto"))
    if isinstance(payload.get("parallel_tool_calls"), bool):
        chat["parallel_tool_calls"] = payload["parallel_tool_calls"]
    reasoning = payload.get("reasoning")
    if isinstance(reasoning, dict) and isinstance(reasoning.get("effort"), str):
        chat["reasoning_effort"] = reasoning["effort"]
    if isinstance(payload.get("max_output_tokens"), int):
        chat["max_completion_tokens"] = payload["max_output_tokens"]
    return chat, custom_names


def _usage(value: Any) -> Dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    prompt = int(source.get("prompt_tokens") or 0)
    completion = int(source.get("completion_tokens") or 0)
    prompt_details = source.get("prompt_tokens_details")
    completion_details = source.get("completion_tokens_details")
    cached = int(prompt_details.get("cached_tokens") or 0) if isinstance(prompt_details, dict) else 0
    reasoning = (
        int(completion_details.get("reasoning_tokens") or 0)
        if isinstance(completion_details, dict)
        else 0
    )
    return {
        "input_tokens": prompt,
        "output_tokens": completion,
        "total_tokens": int(source.get("total_tokens") or (prompt + completion)),
        "input_tokens_details": {"cached_tokens": cached},
        "output_tokens_details": {"reasoning_tokens": reasoning},
    }


def chat_completion_to_response(
    body: Dict[str, Any], model: str, custom_names: Set[str]
) -> Dict[str, Any]:
    choices = body.get("choices")
    choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
    message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
    response_id = f"resp_{uuid.uuid4().hex}"
    output: List[Dict[str, Any]] = []

    reasoning = message.get("reasoning_content") or message.get("reasoning")
    if isinstance(reasoning, str) and reasoning.strip():
        output.append(
            {
                "id": f"rs_{uuid.uuid4().hex}",
                "type": "reasoning",
                "status": "completed",
                "summary": [{"type": "summary_text", "text": reasoning.strip()}],
            }
        )

    content = _string_content(message.get("content"))
    if content:
        output.append(
            {
                "id": f"msg_{uuid.uuid4().hex}",
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "output_text", "text": content, "annotations": []}],
            }
        )

    tool_calls = message.get("tool_calls")
    for call in tool_calls if isinstance(tool_calls, list) else []:
        if not isinstance(call, dict):
            continue
        function = call.get("function") if isinstance(call.get("function"), dict) else {}
        name = function.get("name")
        call_id = call.get("id") or f"call_{uuid.uuid4().hex}"
        arguments = function.get("arguments")
        if not isinstance(name, str) or not name:
            continue
        if not isinstance(arguments, str):
            arguments = json.dumps(arguments if isinstance(arguments, dict) else {}, ensure_ascii=False)
        if name in custom_names:
            try:
                decoded = json.loads(arguments)
            except Exception:
                decoded = None
            raw_input = decoded.get("input") if isinstance(decoded, dict) else arguments
            output.append(
                {
                    "id": f"ct_{uuid.uuid4().hex}",
                    "type": "custom_tool_call",
                    "call_id": str(call_id),
                    "name": name,
                    "input": _string_content(raw_input),
                }
            )
        else:
            output.append(
                {
                    "id": f"fc_{uuid.uuid4().hex}",
                    "type": "function_call",
                    "call_id": str(call_id),
                    "name": name,
                    "arguments": arguments,
                    "status": "completed",
                }
            )

    return {
        "id": response_id,
        "object": "response",
        "created_at": int(time.time()),
        "status": "completed",
        "model": model,
        "output": output,
        "usage": _usage(body.get("usage")),
    }


def _sse(body: Dict[str, Any]) -> Iterator[str]:
    def event(value: Dict[str, Any]) -> str:
        return f"data: {json.dumps(value, ensure_ascii=False)}\n\n"

    in_progress = {**body, "status": "in_progress", "output": []}
    yield event({"type": "response.created", "response": in_progress})
    for index, item in enumerate(body.get("output") or []):
        added = {**item}
        if "status" in added:
            added["status"] = "in_progress"
        yield event({"type": "response.output_item.added", "output_index": index, "item": added})
        yield event({"type": "response.output_item.done", "output_index": index, "item": item})
    yield event({"type": "response.completed", "response": body})
    yield "data: [DONE]\n\n"


def external_responses_response(
    resolved: ResolvedModel, payload: Dict[str, Any], *, verbose: bool = False
) -> Response:
    chat_payload, custom_names = responses_to_chat_payload(payload)
    upstream = provider_dispatch.chat_completion_response(
        resolved,
        chat_payload,
        verbose=verbose,
        requested_model=(
            payload.get("model") if isinstance(payload.get("model"), str) else None
        ),
        endpoint="responses",
    )
    if upstream.status_code >= 400:
        return upstream
    body = upstream.get_json(silent=True)
    if not isinstance(body, dict):
        return make_response(jsonify({"error": {"message": "Provider returned an unreadable response."}}), 502)

    actual_model = (
        body.get("model")
        if isinstance(body.get("model"), str) and body.get("model").strip()
        else resolved.public_model
    )
    response_body = chat_completion_to_response(body, actual_model, custom_names)
    metadata = response_body.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        response_body["metadata"] = metadata
    metadata["chatmockModelRouting"] = {
        "requestedModel": payload.get("model"),
        "resolvedModel": actual_model,
        "upstreamModel": upstream.headers.get("X-ChatMock-Upstream-Model"),
        "provider": upstream.headers.get("X-ChatMock-Provider"),
        "usedFallback": upstream.headers.get("X-ChatMock-Failover") == "true",
        "requestId": upstream.headers.get("X-ChatMock-Request-Id"),
    }
    if bool(payload.get("stream")):
        response = Response(
            _sse(response_body),
            status=200,
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
    else:
        response = make_response(jsonify(response_body), 200)
    for key, value in build_cors_headers().items():
        response.headers.setdefault(key, value)
    for key in (
        "X-ChatMock-Requested-Model",
        "X-ChatMock-Resolved-Model",
        "X-ChatMock-Upstream-Model",
        "X-ChatMock-Provider",
        "X-ChatMock-Failover",
        "X-ChatMock-Request-Id",
    ):
        if upstream.headers.get(key):
            response.headers[key] = upstream.headers[key]
    return response
