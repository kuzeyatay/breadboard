from __future__ import annotations

"""Client for any upstream that already speaks OpenAI chat completions.

Covers OpenAI, OpenRouter, Groq, DeepSeek, xAI, Mistral, Together, Ollama and
the user-supplied custom endpoint. Because the wire format matches what our own
clients send, a streaming request is relayed byte-for-byte rather than parsed
and re-encoded — that keeps tool calls, logprobs and provider-specific extras
intact without ChatMock having to model any of them.
"""

import json
import os
from typing import Any, Dict, Iterator, List

import requests

from . import transport
from .store import ResolvedCredentials
from .types import ModelCall, ProviderError

# Request fields forwarded upstream. An allowlist (rather than stripping the
# fields Breadboard adds) means a future internal routing field can never leak
# to a third-party provider by accident.
_PASSTHROUGH_FIELDS = frozenset(
    {
        "messages",
        "temperature",
        "top_p",
        "n",
        "stream",
        "stream_options",
        "stop",
        "max_tokens",
        "max_completion_tokens",
        "presence_penalty",
        "frequency_penalty",
        "logit_bias",
        "user",
        "seed",
        "tools",
        "tool_choice",
        "parallel_tool_calls",
        "response_format",
        "logprobs",
        "top_logprobs",
        "reasoning_effort",
    }
)


def build_headers(credentials: ResolvedCredentials) -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if credentials.api_key:
        headers["Authorization"] = f"Bearer {credentials.api_key}"
    if credentials.provider_id == "openrouter":
        # OpenRouter attributes traffic with these; harmless elsewhere but only
        # sent where it is documented.
        headers["HTTP-Referer"] = "https://github.com/breadboard"
        headers["X-Title"] = "Breadboard"
    return headers


def _unwrap_double_wrapped_tool(tool: Any) -> Any:
    """Flatten ``{"type": "function", "function": {"type": "function", "function": {...}}}``.

    A client that wraps an already-wrapped tool definition sends a function
    object carrying stray ``type``/``function`` keys. OpenAI-style upstreams
    ignore them; Gemini (reached through CLIProxyAPI) rejects the whole
    request with ``Unknown name "type" at request.tools[0].function_declarations[N]``.
    The inner definition is the real one, so use it.
    """
    if not isinstance(tool, dict):
        return tool
    function = tool.get("function")
    if not isinstance(function, dict):
        return tool
    inner = function.get("function")
    if function.get("type") != "function" or not isinstance(inner, dict):
        return tool
    if not isinstance(inner.get("name"), str):
        return tool
    flattened = {key: value for key, value in function.items() if key not in ("type", "function")}
    # The inner definition is authoritative; the registry-added outer name is
    # only kept when the inner one lacks it.
    merged = {**flattened, **inner}
    return _unwrap_double_wrapped_tool({**tool, "function": merged})


def _normalized_tools(tools: Any) -> Any:
    """Give every function tool an explicit parameter schema.

    OpenAI lets a no-argument tool omit `parameters`, but gateways backed by
    Anthropic (CLIProxyAPI serving a Claude subscription, for instance) forward
    it as `input_schema`, which is required — so a perfectly valid OpenAI tool
    definition comes back as `tools.0.custom.input_schema: Field required`.
    """
    if not isinstance(tools, list):
        return tools

    normalized = []
    for tool in tools:
        tool = _unwrap_double_wrapped_tool(tool)
        function = tool.get("function") if isinstance(tool, dict) else None
        if isinstance(function, dict) and not function.get("parameters"):
            tool = {
                **tool,
                "function": {**function, "parameters": {"type": "object", "properties": {}}},
            }
        normalized.append(tool)
    return normalized


_IMAGE_PART_TYPES = frozenset({"image_url", "image", "input_image"})


def _is_image_part(part: Any) -> bool:
    return isinstance(part, dict) and part.get("type") in _IMAGE_PART_TYPES


def _tool_label(message: Dict[str, Any]) -> str:
    name = message.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    call_id = message.get("tool_call_id")
    if isinstance(call_id, str) and call_id.strip():
        return call_id.strip()
    return "tool"


def _hoist_tool_result_images(messages: Any) -> Any:
    """Move image parts out of ``role: tool`` messages into a user message.

    Hermes returns every ``browser_terminal`` / ``computer_use`` screenshot as an
    ``image_url`` part inside the tool result. OpenAI's own wire format only
    allows text there, and CLIProxyAPI's Gemini translation stringifies the
    whole content list into the ``functionResponse`` text — data URL included —
    so the screenshot is billed as base64 *text*: measured 2026-09-18, one 60 KB
    JPEG cost 1,090 prompt tokens in a user message and 53,326 in a tool
    message; a 977 KB PNG capture cost 986,157, and the turn died with "The
    input token count exceeds the maximum number of tokens allowed 1048576".

    The text stays in the tool result, so the tool-call/tool-result pairing the
    upstream validates is untouched; the images follow the whole run of tool
    results as one user message (inserting between two results of the same
    batch would break that pairing). A user message already following the run
    receives the images at its front instead, so no two user messages are
    sent back to back.
    """
    if not isinstance(messages, list):
        return messages
    if not any(
        isinstance(m, dict)
        and m.get("role") == "tool"
        and isinstance(m.get("content"), list)
        and any(_is_image_part(p) for p in m["content"])
        for m in messages
    ):
        return messages

    out: List[Any] = []
    pending: List[Dict[str, Any]] = []

    def flush(next_message: Any) -> Any:
        nonlocal pending
        if not pending:
            return next_message
        parts, pending = pending, []
        if isinstance(next_message, dict) and next_message.get("role") == "user":
            content = next_message.get("content")
            if isinstance(content, list):
                tail = list(content)
            elif isinstance(content, str) and content:
                tail = [{"type": "text", "text": content}]
            else:
                tail = []
            return {**next_message, "content": parts + tail}
        out.append({"role": "user", "content": parts})
        return next_message

    for message in messages:
        if (
            isinstance(message, dict)
            and message.get("role") == "tool"
            and isinstance(message.get("content"), list)
        ):
            images = [p for p in message["content"] if _is_image_part(p)]
            if images:
                text = [p for p in message["content"] if not _is_image_part(p)]
                label = _tool_label(message)
                marker = {
                    "type": "text",
                    "text": f"[{len(images)} screenshot(s) from this {label} result follow in the next message]",
                }
                pending.append(
                    {"type": "text", "text": f"Screenshot(s) returned by {label}:"}
                )
                pending.extend(images)
                out.append({**message, "content": text + [marker]})
                continue
            out.append(message)
            continue
        message = flush(message)
        out.append(message)
    flush(None)
    return out


# OpenRouter reserves credit for the whole output allowance before it serves a
# request, and when a request names no allowance it reserves the model's
# maximum — 64,000 tokens for Claude Sonnet 4.5, close to a dollar per call at
# list price. A balance that would comfortably pay for the answer then gets
# "This request requires more credits, or fewer max_tokens" (HTTP 402), which
# is how every paid OpenRouter model on this install answered for two weeks.
# Reasonable answers fit well inside this; a caller that asks for less keeps
# its own number.
OPENROUTER_MAX_TOKENS_ENV = "CHATMOCK_OPENROUTER_MAX_TOKENS"
DEFAULT_OPENROUTER_MAX_TOKENS = 16_384
_CAPPED_PROVIDERS = frozenset({"openrouter"})


def output_token_cap(provider_id: str | None) -> int | None:
    if provider_id not in _CAPPED_PROVIDERS:
        return None
    raw = (os.getenv(OPENROUTER_MAX_TOKENS_ENV) or "").strip()
    if raw:
        try:
            value = int(raw)
            if value > 0:
                return value
        except ValueError:
            pass
    return DEFAULT_OPENROUTER_MAX_TOKENS


def _cap_output_tokens(out: Dict[str, Any], cap: int | None) -> None:
    if cap is None:
        return
    for field in ("max_tokens", "max_completion_tokens"):
        value = out.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            out.pop(field, None)
            continue
        out[field] = min(value, cap)
    if "max_tokens" not in out and "max_completion_tokens" not in out:
        out["max_tokens"] = cap


def build_payload(
    payload: Dict[str, Any],
    upstream_model: str,
    *,
    stream: bool,
    provider_id: str | None = None,
) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        key: value for key, value in payload.items() if key in _PASSTHROUGH_FIELDS
    }
    out["model"] = upstream_model
    out["stream"] = bool(stream)
    if not stream:
        out.pop("stream_options", None)
    if "tools" in out:
        out["tools"] = _normalized_tools(out["tools"])
    if "messages" in out:
        out["messages"] = _hoist_tool_result_images(out["messages"])
    _cap_output_tokens(out, output_token_cap(provider_id))
    return out


def chat_url(credentials: ResolvedCredentials) -> str:
    base = (credentials.base_url or "").rstrip("/")
    # Bases are normally given with the version segment (".../v1"). Tolerate one
    # given without it so a pasted host still works.
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def models_url(credentials: ResolvedCredentials) -> str:
    return f"{(credentials.base_url or '').rstrip('/')}/models"


def request_chat(
    credentials: ResolvedCredentials,
    payload: Dict[str, Any],
    upstream_model: str,
    *,
    stream: bool,
    allow_preconnect_retry: bool = True,
) -> requests.Response:
    return transport.post_with_retry(
        chat_url(credentials),
        headers=build_headers(credentials),
        payload=build_payload(
            payload, upstream_model, stream=stream, provider_id=credentials.provider_id
        ),
        stream=stream,
        provider_id=credentials.provider_id,
        allow_preconnect_retry=allow_preconnect_retry,
    )


def relay_stream(response: requests.Response) -> Iterator[bytes]:
    """Relay an upstream SSE body unchanged, normalizing frame separators."""
    try:
        for raw in response.iter_lines(decode_unicode=False):
            if raw is None:
                continue
            line = raw if isinstance(raw, (bytes, bytearray)) else str(raw).encode("utf-8")
            if not line:
                continue
            yield bytes(line) + b"\n\n"
    finally:
        transport.close_quietly(response)


def list_models(credentials: ResolvedCredentials) -> List[str]:
    body = transport.get_json(
        models_url(credentials),
        headers=build_headers(credentials),
        provider_id=credentials.provider_id,
    )
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, list):
        return []
    ids: List[str] = []
    for entry in data:
        model_id = entry.get("id") if isinstance(entry, dict) else None
        if isinstance(model_id, str) and model_id.strip():
            ids.append(model_id.strip())
    return ids


def call_model(call: ModelCall, credentials: ResolvedCredentials, upstream_model: str) -> str:
    """Single non-streaming call used by the council."""
    messages: List[Dict[str, Any]] = []
    if isinstance(call.system, str) and call.system.strip():
        messages.append({"role": "system", "content": call.system})
    messages.extend(call.messages or [])

    payload: Dict[str, Any] = {"messages": messages}
    if call.temperature is not None:
        payload["temperature"] = call.temperature
    if call.max_tokens is not None:
        payload["max_tokens"] = call.max_tokens
    if isinstance(call.reasoning_effort, str) and call.reasoning_effort.strip():
        payload["reasoning_effort"] = call.reasoning_effort.strip()

    request_kwargs = {"stream": False}
    if not call.allow_transport_retry:
        request_kwargs["allow_preconnect_retry"] = False
    response = request_chat(credentials, payload, upstream_model, **request_kwargs)
    if response.status_code >= 400:
        status = response.status_code
        message = transport.error_message(response, credentials.provider_id)
        transport.close_quietly(response)
        raise ProviderError(
            message,
            status_code=status,
            phase="upstream",
            replay_safe=status == 429,
            code="http_error",
        )

    try:
        body = response.json()
    except ValueError as exc:
        raise ProviderError(
            f"{transport.provider_label(credentials.provider_id)} returned a response "
            "that could not be read."
        ) from exc
    finally:
        transport.close_quietly(response)

    return _extract_text(body, call, credentials.provider_id)


def _extract_text(body: Any, call: ModelCall, provider_id: str) -> str:
    if not isinstance(body, dict):
        raise ProviderError(f"{transport.provider_label(provider_id)} returned an unexpected response.")

    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ProviderError(f"{transport.provider_label(provider_id)} returned no answer.")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        raise ProviderError(f"{transport.provider_label(provider_id)} returned an empty answer.")

    content = message.get("content")
    text = content if isinstance(content, str) else _join_content_parts(content)

    reasoning = message.get("reasoning_content") or message.get("reasoning")
    if isinstance(reasoning, str) and reasoning.strip():
        call.reasoning_out = reasoning.strip()

    call.usage_out = _token_usage(body.get("usage"))
    return text


def _join_content_parts(content: Any) -> str:
    if not isinstance(content, list):
        return ""
    parts: List[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict) and isinstance(item.get("text"), str):
            parts.append(item["text"])
    return "".join(parts)


def _token_usage(usage: Any):
    from .types import ModelTokenUsage

    if not isinstance(usage, dict):
        return None
    try:
        prompt = int(usage.get("prompt_tokens") or 0)
        completion = int(usage.get("completion_tokens") or 0)
        total = int(usage.get("total_tokens") or (prompt + completion))
    except (TypeError, ValueError):
        return None

    details = usage.get("completion_tokens_details")
    reasoning = 0
    if isinstance(details, dict):
        try:
            reasoning = int(details.get("reasoning_tokens") or 0)
        except (TypeError, ValueError):
            reasoning = 0

    prompt_details = usage.get("prompt_tokens_details")
    cached = 0
    if isinstance(prompt_details, dict):
        try:
            cached = int(prompt_details.get("cached_tokens") or 0)
        except (TypeError, ValueError):
            cached = 0

    return ModelTokenUsage(
        input_tokens=prompt,
        output_tokens=completion,
        total_tokens=total,
        cached_input_tokens=cached,
        reasoning_tokens=reasoning,
    )


def verify(credentials: ResolvedCredentials) -> Dict[str, Any]:
    """Cheap credential check used by the settings UI."""
    try:
        models = list_models(credentials)
    except ProviderError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "models": models[:200]}


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)
