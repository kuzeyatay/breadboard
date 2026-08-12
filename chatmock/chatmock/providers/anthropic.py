from __future__ import annotations

"""Anthropic Messages API client, translated to and from OpenAI chat shape.

Anthropic is close enough to the OpenAI schema that a field-level translation is
tractable, and native access (rather than routing Claude through an aggregator)
keeps prompt caching, thinking blocks and tool use available.
"""

import json
import time
import uuid
from typing import Any, Dict, Iterator, List, Tuple

import requests

from . import transport
from .store import ResolvedCredentials
from .types import ModelCall, ModelTokenUsage, ProviderError

ANTHROPIC_VERSION = "2023-06-01"
# Anthropic requires max_tokens. OpenAI clients often omit it, so pick a value
# large enough for normal answers without capping long generations early.
DEFAULT_MAX_TOKENS = 8192

# Anthropic has no `reasoning_effort`; it takes an explicit thinking budget.
# Mapping the effort ladder onto budgets is what makes the UI's intelligence
# modes real for Claude rather than a control that does nothing.
THINKING_BUDGETS = {"low": 4096, "medium": 8192, "high": 16384}
# The API requires max_tokens to exceed the thinking budget, and leaves this
# much room for the answer itself on top of it.
_ANSWER_HEADROOM_TOKENS = 4096

_STOP_REASON_MAP = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "max_tokens": "length",
    "tool_use": "tool_calls",
}


def build_headers(credentials: ResolvedCredentials) -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        "x-api-key": credentials.api_key or "",
        "anthropic-version": ANTHROPIC_VERSION,
    }


def messages_url(credentials: ResolvedCredentials) -> str:
    return f"{(credentials.base_url or '').rstrip('/')}/v1/messages"


def _text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: List[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict):
            if isinstance(item.get("text"), str):
                parts.append(item["text"])
    return "".join(parts)


def _content_blocks(content: Any) -> List[Dict[str, Any]]:
    """Translate OpenAI message content (text or multimodal parts) to blocks."""
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    if not isinstance(content, list):
        return []

    blocks: List[Dict[str, Any]] = []
    for item in content:
        if isinstance(item, str):
            if item:
                blocks.append({"type": "text", "text": item})
            continue
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type in ("text", "input_text") and isinstance(item.get("text"), str):
            blocks.append({"type": "text", "text": item["text"]})
        elif item_type in ("image_url", "input_image"):
            url = item.get("image_url")
            if isinstance(url, dict):
                url = url.get("url")
            if isinstance(url, str) and url.startswith("data:"):
                header, _, data = url.partition(",")
                media_type = header[5:].split(";")[0] or "image/png"
                blocks.append(
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": data},
                    }
                )
            elif isinstance(url, str) and url:
                blocks.append({"type": "image", "source": {"type": "url", "url": url}})
    return blocks


def convert_messages(messages: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], str | None]:
    """Split OpenAI messages into Anthropic messages plus the system prompt."""
    system_parts: List[str] = []
    converted: List[Dict[str, Any]] = []

    for message in messages or []:
        if not isinstance(message, dict):
            continue
        role = message.get("role")

        if role in ("system", "developer"):
            text = _text_from_content(message.get("content"))
            if text:
                system_parts.append(text)
            continue

        if role == "tool":
            # Anthropic carries tool results as user-turn blocks.
            block = {
                "type": "tool_result",
                "tool_use_id": message.get("tool_call_id") or "",
                "content": _text_from_content(message.get("content")),
            }
            if converted and converted[-1]["role"] == "user":
                converted[-1]["content"].append(block)
            else:
                converted.append({"role": "user", "content": [block]})
            continue

        if role == "assistant":
            blocks = _content_blocks(message.get("content"))
            for tool_call in message.get("tool_calls") or []:
                if not isinstance(tool_call, dict):
                    continue
                function = tool_call.get("function") or {}
                try:
                    arguments = json.loads(function.get("arguments") or "{}")
                except ValueError:
                    arguments = {}
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": tool_call.get("id") or f"toolu_{uuid.uuid4().hex[:16]}",
                        "name": function.get("name") or "",
                        "input": arguments if isinstance(arguments, dict) else {},
                    }
                )
            if blocks:
                converted.append({"role": "assistant", "content": blocks})
            continue

        blocks = _content_blocks(message.get("content"))
        if blocks:
            converted.append({"role": "user", "content": blocks})

    # A leading assistant turn is rejected upstream; drop it rather than fail.
    while converted and converted[0]["role"] == "assistant":
        converted.pop(0)

    return converted, "\n\n".join(system_parts) if system_parts else None


def convert_tools(tools: Any) -> List[Dict[str, Any]]:
    if not isinstance(tools, list):
        return []
    out: List[Dict[str, Any]] = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        function = tool.get("function") if tool.get("type") == "function" else tool
        if not isinstance(function, dict) or not isinstance(function.get("name"), str):
            continue
        out.append(
            {
                "name": function["name"],
                "description": function.get("description") or "",
                "input_schema": function.get("parameters")
                or {"type": "object", "properties": {}},
            }
        )
    return out


def convert_tool_choice(tool_choice: Any) -> Dict[str, Any] | None:
    if tool_choice == "required":
        return {"type": "any"}
    if tool_choice == "none":
        return None
    if isinstance(tool_choice, dict):
        function = tool_choice.get("function")
        if isinstance(function, dict) and isinstance(function.get("name"), str):
            return {"type": "tool", "name": function["name"]}
    return None


def build_payload(payload: Dict[str, Any], upstream_model: str, *, stream: bool) -> Dict[str, Any]:
    messages, system = convert_messages(payload.get("messages") or [])
    body: Dict[str, Any] = {
        "model": upstream_model,
        "messages": messages,
        "max_tokens": _resolve_max_tokens(payload),
        "stream": bool(stream),
    }
    if system:
        body["system"] = system

    effort = payload.get("reasoning_effort")
    budget = THINKING_BUDGETS.get(effort.strip().lower()) if isinstance(effort, str) else None
    if budget is not None:
        body["thinking"] = {"type": "enabled", "budget_tokens": budget}
        # max_tokens covers the thinking budget plus the answer, so raise it when
        # the caller's value would leave no room (or be rejected outright).
        body["max_tokens"] = max(body["max_tokens"], budget + _ANSWER_HEADROOM_TOKENS)

    if isinstance(payload.get("temperature"), (int, float)) and budget is None:
        # Extended thinking requires the default temperature; sending one
        # alongside it is rejected.
        body["temperature"] = payload["temperature"]
    if isinstance(payload.get("top_p"), (int, float)) and budget is None:
        body["top_p"] = payload["top_p"]
    stop = payload.get("stop")
    if isinstance(stop, str):
        body["stop_sequences"] = [stop]
    elif isinstance(stop, list):
        body["stop_sequences"] = [s for s in stop if isinstance(s, str)]

    tools = convert_tools(payload.get("tools"))
    if tools:
        body["tools"] = tools
        choice = convert_tool_choice(payload.get("tool_choice"))
        if choice:
            body["tool_choice"] = choice
    return body


def _resolve_max_tokens(payload: Dict[str, Any]) -> int:
    for key in ("max_completion_tokens", "max_tokens"):
        value = payload.get(key)
        if isinstance(value, int) and value > 0:
            return value
    return DEFAULT_MAX_TOKENS


def request_chat(
    credentials: ResolvedCredentials,
    payload: Dict[str, Any],
    upstream_model: str,
    *,
    stream: bool,
) -> requests.Response:
    return transport.post_with_retry(
        messages_url(credentials),
        headers=build_headers(credentials),
        payload=build_payload(payload, upstream_model, stream=stream),
        stream=stream,
        provider_id=credentials.provider_id,
    )


def _usage_from(value: Any) -> Dict[str, Any]:
    """Translate Anthropic's usage object without dropping cached input.

    Anthropic reports uncached input, cache writes, and cache reads as separate
    fields. OpenAI-shaped clients expect all three in ``prompt_tokens`` while
    ``prompt_tokens_details.cached_tokens`` identifies the cache-hit subset.
    """
    if not isinstance(value, dict):
        value = {}

    def count(key: str) -> int:
        try:
            return max(0, int(value.get(key) or 0))
        except (TypeError, ValueError):
            return 0

    uncached_input = count("input_tokens")
    cache_creation = count("cache_creation_input_tokens")
    cache_read = count("cache_read_input_tokens")
    prompt = uncached_input + cache_creation + cache_read
    completion = count("output_tokens")
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
        "prompt_tokens_details": {"cached_tokens": cache_read},
    }


def translate_stream(
    response: requests.Response,
    *,
    public_model: str,
    include_usage: bool,
) -> Iterator[bytes]:
    """Anthropic SSE -> OpenAI chat.completion.chunk frames."""
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
    created = int(time.time())
    usage: Dict[str, Any] = _usage_from(None)
    finish_reason = "stop"
    # Anthropic streams tool arguments as partial JSON per content block index.
    tool_index_by_block: Dict[int, int] = {}
    next_tool_index = 0
    emitted_role = False

    try:
        for _, event in transport.iter_sse_json(response):
            event_type = event.get("type")

            if event_type == "message_start":
                message = event.get("message")
                if isinstance(message, dict):
                    usage = _usage_from(message.get("usage"))
                if not emitted_role:
                    emitted_role = True
                    yield transport.sse_chunk(
                        transport.chat_chunk(
                            completion_id=completion_id,
                            created=created,
                            model=public_model,
                            delta={"role": "assistant", "content": ""},
                        )
                    )
                continue

            if event_type == "content_block_start":
                block = event.get("content_block")
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    index = event.get("index")
                    if isinstance(index, int):
                        tool_index_by_block[index] = next_tool_index
                        yield transport.sse_chunk(
                            transport.chat_chunk(
                                completion_id=completion_id,
                                created=created,
                                model=public_model,
                                delta={
                                    "tool_calls": [
                                        {
                                            "index": next_tool_index,
                                            "id": block.get("id") or f"toolu_{uuid.uuid4().hex[:16]}",
                                            "type": "function",
                                            "function": {
                                                "name": block.get("name") or "",
                                                "arguments": "",
                                            },
                                        }
                                    ]
                                },
                            )
                        )
                        next_tool_index += 1
                continue

            if event_type == "content_block_delta":
                delta = event.get("delta")
                if not isinstance(delta, dict):
                    continue
                delta_type = delta.get("type")
                if delta_type == "text_delta" and isinstance(delta.get("text"), str):
                    yield transport.sse_chunk(
                        transport.chat_chunk(
                            completion_id=completion_id,
                            created=created,
                            model=public_model,
                            delta={"content": delta["text"]},
                        )
                    )
                elif delta_type == "thinking_delta" and isinstance(delta.get("thinking"), str):
                    yield transport.sse_chunk(
                        transport.chat_chunk(
                            completion_id=completion_id,
                            created=created,
                            model=public_model,
                            delta={"reasoning_content": delta["thinking"]},
                        )
                    )
                elif delta_type == "input_json_delta":
                    index = event.get("index")
                    tool_index = tool_index_by_block.get(index) if isinstance(index, int) else None
                    partial = delta.get("partial_json")
                    if tool_index is not None and isinstance(partial, str):
                        yield transport.sse_chunk(
                            transport.chat_chunk(
                                completion_id=completion_id,
                                created=created,
                                model=public_model,
                                delta={
                                    "tool_calls": [
                                        {
                                            "index": tool_index,
                                            "function": {"arguments": partial},
                                        }
                                    ]
                                },
                            )
                        )
                continue

            if event_type == "message_delta":
                delta = event.get("delta")
                if isinstance(delta, dict):
                    stop_reason = delta.get("stop_reason")
                    if isinstance(stop_reason, str):
                        finish_reason = _STOP_REASON_MAP.get(stop_reason, "stop")
                event_usage = event.get("usage")
                if isinstance(event_usage, dict):
                    merged = _usage_from(event_usage)
                    # message_delta reports only output tokens; keep the input
                    # count captured at message_start.
                    if "output_tokens" in event_usage:
                        usage["completion_tokens"] = merged["completion_tokens"]
                        usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
                continue

            if event_type == "error":
                error = event.get("error")
                message = error.get("message") if isinstance(error, dict) else None
                raise ProviderError(
                    f"anthropic stream error: {message}" if isinstance(message, str) else "anthropic stream error"
                )
    finally:
        transport.close_quietly(response)

    yield transport.sse_chunk(
        transport.chat_chunk(
            completion_id=completion_id,
            created=created,
            model=public_model,
            delta={},
            finish_reason=finish_reason,
            usage=usage if include_usage else None,
        )
    )
    yield transport.SSE_DONE


def translate_response(body: Any, *, public_model: str) -> Dict[str, Any]:
    """Anthropic non-streaming body -> OpenAI chat.completion body."""
    if not isinstance(body, dict):
        raise ProviderError("anthropic returned an unexpected response shape")

    text_parts: List[str] = []
    reasoning_parts: List[str] = []
    tool_calls: List[Dict[str, Any]] = []
    for block in body.get("content") or []:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text" and isinstance(block.get("text"), str):
            text_parts.append(block["text"])
        elif block_type == "thinking" and isinstance(block.get("thinking"), str):
            reasoning_parts.append(block["thinking"])
        elif block_type == "tool_use":
            tool_calls.append(
                {
                    "id": block.get("id") or f"toolu_{uuid.uuid4().hex[:16]}",
                    "type": "function",
                    "function": {
                        "name": block.get("name") or "",
                        "arguments": json.dumps(block.get("input") or {}, ensure_ascii=False),
                    },
                }
            )

    stop_reason = body.get("stop_reason")
    finish_reason = _STOP_REASON_MAP.get(stop_reason, "stop") if isinstance(stop_reason, str) else "stop"

    return transport.chat_completion(
        completion_id=body.get("id") or f"chatcmpl-{uuid.uuid4().hex[:24]}",
        created=int(time.time()),
        model=public_model,
        content="".join(text_parts),
        finish_reason=finish_reason,
        usage=_usage_from(body.get("usage")),
        reasoning="".join(reasoning_parts) or None,
        tool_calls=tool_calls or None,
    )


def call_model(call: ModelCall, credentials: ResolvedCredentials, upstream_model: str) -> str:
    messages = list(call.messages or [])
    if isinstance(call.system, str) and call.system.strip():
        messages.insert(0, {"role": "system", "content": call.system})

    payload: Dict[str, Any] = {"messages": messages}
    if call.temperature is not None:
        payload["temperature"] = call.temperature
    if call.max_tokens is not None:
        payload["max_tokens"] = call.max_tokens
    if isinstance(call.reasoning_effort, str) and call.reasoning_effort.strip():
        # Council seats carry a per-request effort; build_payload turns it into
        # a thinking budget.
        payload["reasoning_effort"] = call.reasoning_effort.strip()

    response = request_chat(credentials, payload, upstream_model, stream=False)
    if response.status_code >= 400:
        message = transport.error_message(response, credentials.provider_id)
        transport.close_quietly(response)
        raise ProviderError(message)
    try:
        body = response.json()
    except ValueError as exc:
        raise ProviderError(
            f"{transport.provider_label(credentials.provider_id)} returned a response "
            "that could not be read."
        ) from exc
    finally:
        transport.close_quietly(response)

    completion = translate_response(body, public_model=upstream_model)
    message = completion["choices"][0]["message"]
    reasoning = message.get("reasoning_content")
    if isinstance(reasoning, str) and reasoning.strip():
        call.reasoning_out = reasoning.strip()
    usage = completion.get("usage") or {}
    prompt_details = usage.get("prompt_tokens_details")
    cached_input_tokens = (
        int(prompt_details.get("cached_tokens") or 0)
        if isinstance(prompt_details, dict)
        else 0
    )
    call.usage_out = ModelTokenUsage(
        input_tokens=int(usage.get("prompt_tokens") or 0),
        output_tokens=int(usage.get("completion_tokens") or 0),
        total_tokens=int(usage.get("total_tokens") or 0),
        cached_input_tokens=cached_input_tokens,
    )
    content = message.get("content")
    return content if isinstance(content, str) else ""


def verify(credentials: ResolvedCredentials) -> Dict[str, Any]:
    """List models to confirm the key works."""
    try:
        body = transport.get_json(
            f"{(credentials.base_url or '').rstrip('/')}/v1/models",
            headers=build_headers(credentials),
            provider_id=credentials.provider_id,
        )
    except ProviderError as exc:
        return {"ok": False, "error": str(exc)}
    data = body.get("data") if isinstance(body, dict) else None
    models = [
        entry["id"]
        for entry in (data if isinstance(data, list) else [])
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    ]
    return {"ok": True, "models": models[:200]}
