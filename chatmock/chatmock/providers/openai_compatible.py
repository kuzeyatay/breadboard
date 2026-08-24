from __future__ import annotations

"""Client for any upstream that already speaks OpenAI chat completions.

Covers OpenAI, OpenRouter, Groq, DeepSeek, xAI, Mistral, Together, Ollama and
the user-supplied custom endpoint. Because the wire format matches what our own
clients send, a streaming request is relayed byte-for-byte rather than parsed
and re-encoded — that keeps tool calls, logprobs and provider-specific extras
intact without ChatMock having to model any of them.
"""

import json
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
        function = tool.get("function") if isinstance(tool, dict) else None
        if isinstance(function, dict) and not function.get("parameters"):
            tool = {
                **tool,
                "function": {**function, "parameters": {"type": "object", "properties": {}}},
            }
        normalized.append(tool)
    return normalized


def build_payload(payload: Dict[str, Any], upstream_model: str, *, stream: bool) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        key: value for key, value in payload.items() if key in _PASSTHROUGH_FIELDS
    }
    out["model"] = upstream_model
    out["stream"] = bool(stream)
    if not stream:
        out.pop("stream_options", None)
    if "tools" in out:
        out["tools"] = _normalized_tools(out["tools"])
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
        payload=build_payload(payload, upstream_model, stream=stream),
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
