from __future__ import annotations

"""Shared HTTP and SSE plumbing for the non-ChatGPT providers.

The ChatGPT upstream has its own retry/timeout knobs in ``chatmock.upstream``
because it speaks the Responses API against a fixed URL. External providers
share this smaller helper instead: same retry shape, provider-neutral env
names, and error strings that never echo a raw upstream body (which can contain
the API key that was rejected).
"""

import json
import os
import time
from typing import Any, Callable, Dict, Iterator, Tuple

import requests

from .catalog import provider_spec
from .types import ProviderError

# Quota responses are deliberately not retried here. The dispatcher classifies
# 429s, records the cooldown, and moves to a healthy model. Retrying the same
# subscription model first is especially harmful for Google via CLIProxyAPI:
# each exhausted request can take roughly forty seconds, so three attempts run
# past Breadboard's response watchdog before failover gets a chance to start.
_RETRYABLE_STATUS = frozenset({408, 500, 502, 503, 504})

_DEFAULT_CONNECT_TIMEOUT = 30.0
_DEFAULT_READ_TIMEOUT = 300.0
_DEFAULT_MAX_ATTEMPTS = 3
_DEFAULT_BACKOFF = 1.0


def _env_float(name: str, default: float, *, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


def provider_label(provider_id: str) -> str:
    """The provider's user-facing name.

    Every string in this module can end up in front of a user — a failed call
    becomes the assistant's answer rather than a silent stall — so none of them
    may carry an internal routing id. ``cliproxy`` is Breadboard's own
    subscription proxy; naming it tells a reader nothing and reads like a bug.
    The catalog label is what the settings UI already calls the same provider.
    """
    spec = provider_spec(provider_id)
    return spec.label if spec is not None else "The model provider"


def timeouts() -> Tuple[float, float]:
    return (
        _env_float("CHATMOCK_PROVIDER_CONNECT_TIMEOUT", _DEFAULT_CONNECT_TIMEOUT, minimum=1.0, maximum=300.0),
        _env_float("CHATMOCK_PROVIDER_READ_TIMEOUT", _DEFAULT_READ_TIMEOUT, minimum=5.0, maximum=1800.0),
    )


def post_with_retry(
    url: str,
    *,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    stream: bool,
    provider_id: str,
) -> requests.Response:
    """POST JSON with bounded retries. Raises ProviderError on give-up."""
    max_attempts = _env_int("CHATMOCK_PROVIDER_MAX_ATTEMPTS", _DEFAULT_MAX_ATTEMPTS, minimum=1, maximum=5)
    backoff = _env_float("CHATMOCK_PROVIDER_RETRY_BACKOFF_SECONDS", _DEFAULT_BACKOFF, minimum=0.0, maximum=30.0)
    connect_timeout, read_timeout = timeouts()

    last_status: int | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
                stream=stream,
                timeout=(connect_timeout, read_timeout),
            )
        except requests.RequestException as exc:
            if attempt < max_attempts:
                _sleep_backoff(backoff, attempt)
                continue
            raise ProviderError(
                f"{provider_label(provider_id)} could not be reached after "
                f"{max_attempts} attempts ({type(exc).__name__})."
            ) from exc

        status = getattr(response, "status_code", 0)
        if status in _RETRYABLE_STATUS and attempt < max_attempts:
            last_status = status
            close_quietly(response)
            _sleep_backoff(backoff, attempt)
            continue
        return response

    raise ProviderError(
        f"{provider_label(provider_id)} kept failing (last status {last_status}).",
        status_code=last_status or None,
    )


def get_json(url: str, *, headers: Dict[str, str], provider_id: str) -> Any:
    connect_timeout, read_timeout = timeouts()
    label = provider_label(provider_id)
    try:
        response = requests.get(url, headers=headers, timeout=(connect_timeout, read_timeout))
    except requests.RequestException as exc:
        raise ProviderError(f"{label} is unreachable ({type(exc).__name__}).") from exc
    if response.status_code >= 400:
        raise ProviderError(
            f"{label} returned HTTP {response.status_code}.",
            status_code=response.status_code,
        )
    try:
        return response.json()
    except ValueError as exc:
        raise ProviderError(f"{label} returned a response that could not be read.") from exc


def _sleep_backoff(base: float, failed_attempt: int) -> None:
    delay = min(30.0, base * (2 ** max(0, failed_attempt - 1)))
    if delay > 0:
        time.sleep(delay)


def close_quietly(response: Any) -> None:
    try:
        response.close()
    except Exception:
        pass


def error_message(response: requests.Response, provider_id: str) -> str:
    """A safe, human-readable error for a failed provider call.

    Only the upstream's own ``error.message`` is surfaced, and only when it is a
    short string; anything else is reduced to the status code so keys, tokens
    and internal URLs in a verbose error body never reach a log or the UI.

    When the upstream explains itself, that sentence is returned *alone*. It is
    written for the person who has to act on it ("Add more at
    claude.ai/settings/usage"), and clients show it as the assistant's answer —
    so wrapping it in routing trivia ("cliproxy returned HTTP 400: …") only
    buries the part that matters behind a name the reader has never seen.
    """
    try:
        body = response.json()
        if isinstance(body, dict):
            error = body.get("error")
            candidate = error.get("message") if isinstance(error, dict) else error
            if isinstance(candidate, str) and 0 < len(candidate.strip()) <= 300:
                return candidate.strip()
    except Exception:
        pass
    return f"{provider_label(provider_id)} returned HTTP {response.status_code}."


def iter_sse_events(response: requests.Response) -> Iterator[Tuple[str | None, str]]:
    """Yield ``(event_name, data)`` pairs from an SSE stream."""
    event_name: str | None = None
    for raw in response.iter_lines(decode_unicode=False):
        if raw is None:
            continue
        line = raw.decode("utf-8", errors="ignore") if isinstance(raw, (bytes, bytearray)) else raw
        if not line:
            event_name = None
            continue
        if line.startswith("event:"):
            event_name = line[len("event:"):].strip()
            continue
        if not line.startswith("data:"):
            continue
        data = line[len("data:"):].strip()
        if data:
            yield event_name, data


def iter_sse_json(response: requests.Response) -> Iterator[Tuple[str | None, Dict[str, Any]]]:
    """Like :func:`iter_sse_events` but skips ``[DONE]`` and unparsable frames."""
    for event_name, data in iter_sse_events(response):
        if data == "[DONE]":
            return
        try:
            parsed = json.loads(data)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            yield event_name, parsed


def sse_chunk(payload: Dict[str, Any]) -> bytes:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


SSE_DONE = b"data: [DONE]\n\n"


def chat_chunk(
    *,
    completion_id: str,
    created: int,
    model: str,
    delta: Dict[str, Any] | None = None,
    finish_reason: str | None = None,
    usage: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """One OpenAI ``chat.completion.chunk`` frame."""
    chunk: Dict[str, Any] = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta or {},
                "finish_reason": finish_reason,
            }
        ],
    }
    if usage is not None:
        chunk["usage"] = usage
    return chunk


def chat_completion(
    *,
    completion_id: str,
    created: int,
    model: str,
    content: str,
    finish_reason: str = "stop",
    usage: Dict[str, Any] | None = None,
    reasoning: str | None = None,
    tool_calls: list[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """A non-streaming OpenAI ``chat.completion`` body."""
    message: Dict[str, Any] = {"role": "assistant", "content": content}
    if reasoning:
        # Mirrors the field names the ChatGPT path already emits so clients that
        # render reasoning keep working across providers.
        message["reasoning_content"] = reasoning
        message["reasoning"] = reasoning
    if tool_calls:
        message["tool_calls"] = tool_calls
        message["content"] = content or None
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
        "usage": usage
        or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def guard_stream(
    provider_id: str,
    generator: Callable[[], Iterator[bytes]],
) -> Iterator[bytes]:
    """Run a translating stream, converting a mid-stream failure into a final
    OpenAI-shaped error frame instead of a truncated body."""
    try:
        yield from generator()
    except ProviderError as exc:
        yield sse_chunk({"error": {"message": str(exc)}})
        yield SSE_DONE
    except Exception:
        yield sse_chunk(
            {"error": {"message": f"{provider_label(provider_id)} stopped mid-response."}}
        )
        yield SSE_DONE
