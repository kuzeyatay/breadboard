from __future__ import annotations

import json
import os
import ssl
import time
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse, urlunparse

import certifi
import requests
from flask import Response, current_app, jsonify, make_response
from websockets.sync.client import connect as websocket_connect

from .config import CHATGPT_RESPONSES_URL
from .http_replay_safety import is_proven_preconnect_failure
from .limits import parse_rate_limit_headers, spent_window_message
from .http import build_cors_headers
from .model_registry import normalize_model_name
from .accounts import note_account_exhausted, select_account
from .failover import is_quota_error
from .session import ensure_session_id
from flask import request as flask_request
from .utils import get_effective_chatgpt_auth


_DEFAULT_CONNECT_TIMEOUT_SECONDS = 30.0
_DEFAULT_READ_TIMEOUT_SECONDS = 120.0
_DEFAULT_MAX_ATTEMPTS = 3
_DEFAULT_RETRY_BACKOFF_SECONDS = 1.0
_DEFAULT_WEBSOCKET_MAX_MESSAGE_BYTES = 16 * 1024 * 1024
_MIN_WEBSOCKET_MAX_MESSAGE_BYTES = 1024 * 1024
_MAX_WEBSOCKET_MAX_MESSAGE_BYTES = 128 * 1024 * 1024


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


def _retry_delay_seconds(base_delay: float, failed_attempt: int) -> float:
    return min(30.0, base_delay * (2 ** max(0, failed_attempt - 1)))


def upstream_websocket_max_message_bytes() -> int:
    """Bound full Responses events without inheriting a library-sized 1 MiB cap.

    A terminal response may legitimately contain substantially more data than
    any individual delta. Keep the bound finite and configurable, but make it a
    product transport limit rather than an accidental websockets default.
    """

    return _env_int(
        "CHATMOCK_UPSTREAM_WEBSOCKET_MAX_MESSAGE_BYTES",
        _DEFAULT_WEBSOCKET_MAX_MESSAGE_BYTES,
        minimum=_MIN_WEBSOCKET_MAX_MESSAGE_BYTES,
        maximum=_MAX_WEBSOCKET_MAX_MESSAGE_BYTES,
    )


def _close_quietly(response: Any) -> None:
    try:
        response.close()
    except Exception:
        pass


def _note_account_exhausted_quietly(
    account_key: str,
    *,
    reason: str,
    seconds: int | None = None,
) -> None:
    """Persist quota state without replacing the upstream's exact response."""

    try:
        note_account_exhausted(account_key, reason=reason, seconds=seconds)
    except Exception:
        pass


def _log_upstream_retry(reason: str, failed_attempt: int, max_attempts: int, delay: float) -> None:
    try:
        print(
            f"[ChatMock] upstream {reason}; "
            f"retrying attempt {failed_attempt + 1}/{max_attempts} in {delay:g}s"
        )
    except Exception:
        pass


def _log_json(prefix: str, payload: Any) -> None:
    try:
        print(f"{prefix}\n{json.dumps(payload, indent=2, ensure_ascii=False)}")
    except Exception:
        try:
            print(f"{prefix}\n{payload}")
        except Exception:
            pass

def start_upstream_request(
    model: str,
    input_items: List[Dict[str, Any]],
    *,
    instructions: str | None = None,
    tools: List[Dict[str, Any]] | None = None,
    tool_choice: Any | None = None,
    parallel_tool_calls: bool = False,
    reasoning_param: Dict[str, Any] | None = None,
    service_tier: str | None = None,
    strict_single_attempt: bool = False,
):
    account = select_account()
    access_token, account_id = get_effective_chatgpt_auth(
        (account.auth, account.path) if account is not None else None
    )
    if not access_token or not account_id:
        resp = make_response(
            jsonify(
                {
                    "error": {
                        "message": "Missing ChatGPT credentials. Run 'python3 chatmock.py login' first.",
                    }
                }
            ),
            401,
        )
        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return None, resp

    include: List[str] = []
    if isinstance(reasoning_param, dict):
        include.append("reasoning.encrypted_content")

    client_session_id = None
    try:
        client_session_id = (
            flask_request.headers.get("X-Session-Id")
            or flask_request.headers.get("session_id")
            or None
        )
    except Exception:
        client_session_id = None
    session_id = ensure_session_id(instructions, input_items, client_session_id)

    responses_payload = {
        "model": model,
        "instructions": instructions if isinstance(instructions, str) and instructions.strip() else instructions,
        "input": input_items,
        "tools": tools or [],
        "tool_choice": tool_choice if tool_choice in ("auto", "none") or isinstance(tool_choice, dict) else "auto",
        "parallel_tool_calls": bool(parallel_tool_calls),
        "store": False,
        "stream": True,
        "prompt_cache_key": session_id,
    }
    if include:
        responses_payload["include"] = include

    if reasoning_param is not None:
        responses_payload["reasoning"] = reasoning_param
    if isinstance(service_tier, str) and service_tier.strip():
        responses_payload["service_tier"] = service_tier.strip().lower()

    return start_upstream_raw_request(
        responses_payload,
        session_id=session_id,
        stream=True,
        strict_single_attempt=strict_single_attempt,
    )


def build_upstream_headers(
    access_token: str,
    account_id: str,
    session_id: str,
    *,
    accept: str = "text/event-stream",
) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": accept,
        "chatgpt-account-id": account_id,
        "OpenAI-Beta": "responses=experimental",
        "session_id": session_id,
    }


def start_upstream_raw_request(
    responses_payload: Dict[str, Any],
    *,
    session_id: str | None = None,
    stream: bool = True,
    strict_single_attempt: bool = False,
):
    account = select_account()
    access_token, account_id = get_effective_chatgpt_auth(
        (account.auth, account.path) if account is not None else None
    )
    if not access_token or not account_id:
        resp = make_response(
            jsonify(
                {
                    "error": {
                        "message": "Missing ChatGPT credentials. Run 'python3 chatmock.py login' first.",
                    }
                }
            ),
            401,
        )
        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return None, resp

    effective_session_id = session_id
    if not isinstance(effective_session_id, str) or not effective_session_id.strip():
        payload_prompt_cache_key = responses_payload.get("prompt_cache_key")
        if isinstance(payload_prompt_cache_key, str) and payload_prompt_cache_key.strip():
            effective_session_id = payload_prompt_cache_key.strip()
    if not isinstance(effective_session_id, str) or not effective_session_id.strip():
        effective_session_id = str(int(time.time() * 1000))

    verbose = False
    try:
        verbose = bool(current_app.config.get("VERBOSE"))
    except Exception:
        verbose = False
    if verbose:
        _log_json("OUTBOUND >> ChatGPT Responses API payload", responses_payload)

    headers = build_upstream_headers(
        access_token,
        account_id,
        effective_session_id,
        accept=("text/event-stream" if stream else "application/json"),
    )

    # (connect, read) timeout. With stream=True a scalar timeout only bounds the
    # time to the first byte, so a stalled upstream stream (a reasoning response
    # that stops emitting events mid-flight) would hang until the *client's*
    # timeout — which is exactly the multi-minute "Request timed out." planning
    # failures. A per-read timeout aborts a stalled stream promptly; the backend
    # emits reasoning/keepalive events far more often than this window, so it
    # never trips on a healthy (if slow) generation.
    connect_timeout = _env_float(
        "CHATMOCK_UPSTREAM_CONNECT_TIMEOUT",
        _DEFAULT_CONNECT_TIMEOUT_SECONDS,
        minimum=1.0,
        maximum=300.0,
    )
    read_timeout = _env_float(
        "CHATMOCK_UPSTREAM_READ_TIMEOUT",
        _DEFAULT_READ_TIMEOUT_SECONDS,
        minimum=5.0,
        maximum=1800.0,
    )
    max_attempts = 1 if strict_single_attempt else _env_int(
        "CHATMOCK_UPSTREAM_MAX_ATTEMPTS",
        _DEFAULT_MAX_ATTEMPTS,
        minimum=1,
        maximum=5,
    )
    retry_backoff = _env_float(
        "CHATMOCK_UPSTREAM_RETRY_BACKOFF_SECONDS",
        _DEFAULT_RETRY_BACKOFF_SECONDS,
        minimum=0.0,
        maximum=30.0,
    )

    for attempt in range(1, max_attempts + 1):
        try:
            upstream = requests.post(
                CHATGPT_RESPONSES_URL,
                headers=headers,
                json=responses_payload,
                stream=stream,
                timeout=(connect_timeout, read_timeout),
            )
        except requests.RequestException as exc:
            replay_safe = is_proven_preconnect_failure(exc)
            if replay_safe and attempt < max_attempts:
                delay = _retry_delay_seconds(retry_backoff, attempt)
                _log_upstream_retry(
                    f"pre-connect {type(exc).__name__}",
                    attempt,
                    max_attempts,
                    delay,
                )
                if delay > 0:
                    time.sleep(delay)
                continue
            message = (
                "Upstream ChatGPT could not be reached after "
                f"{attempt} pre-connect attempt{'s' if attempt != 1 else ''} "
                f"({type(exc).__name__})."
                if replay_safe
                else (
                    "Upstream ChatGPT request failed without replay "
                    f"({type(exc).__name__})."
                )
            )
            resp = make_response(jsonify({"error": {"message": message}}), 502)
            for key, value in build_cors_headers().items():
                resp.headers.setdefault(key, value)
            return None, resp

        status_code = getattr(upstream, "status_code", None)

        # A 429 is not a transient failure to retry — this account's plan window
        # is spent, possibly for days. Record that so the next request selects a
        # different account, and hand the caller a sibling's answer instead of
        # the rejection when one is available.
        if status_code == 429 and account is not None:
            detail, resets_in = _quota_detail(upstream)
            _note_account_exhausted_quietly(account.key, reason=detail, seconds=resets_in)
            if verbose:
                print(f"[ChatMock] account {account.label} is out of quota; trying the next one")
            retry = None if strict_single_attempt else _retry_with_next_account(
                responses_payload,
                effective_session_id,
                stream=stream,
                exhausted=account.key,
            )
            if retry is not None:
                _close_quietly(upstream)
                return retry
            # No sibling can take it: the client sees this account's refusal.
            # The response itself stays exactly as the backend sent it — the
            # receipts and rate-limit readers depend on that — but it carries
            # the account, so the relay can say whose window is spent.
            _tag_quota_refusal(upstream, account.label, detail, resets_in)

        _tag_account(upstream, account)
        return upstream, None

    raise AssertionError("pre-connect retry loop ended unexpectedly")


def _human_duration(seconds: int) -> str:
    days, rest = divmod(max(0, int(seconds)), 86400)
    hours, rest = divmod(rest, 3600)
    minutes = rest // 60
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{max(1, minutes)}m"


def _tag_account(upstream: Any, account: Any) -> None:
    """Name the account that paid for this response, for the usage ledger."""
    try:
        upstream.chatmock_account = account
    except Exception:
        pass


def _tag_quota_refusal(upstream: Any, account_label: str, detail: str, resets_in: int | None) -> None:
    try:
        upstream.chatmock_quota_refusal = {
            "account": account_label,
            "detail": detail,
            "resetsInSeconds": resets_in,
        }
    except Exception:
        pass


def quota_refusal_message(upstream: Any) -> str | None:
    """A 429 the reader can act on, or None when this is not a tagged refusal.

    The backend's body says only "The usage limit has been reached", which a
    reader checks against the wrong meter. Name the account, the window, and
    when it comes back instead.
    """
    tag = getattr(upstream, "chatmock_quota_refusal", None)
    if not isinstance(tag, dict):
        return None
    sentence = str(tag.get("detail") or "The usage limit has been reached").rstrip(".")
    message = f"{sentence} for {tag.get('account') or 'the signed-in ChatGPT account'}"
    resets_in = tag.get("resetsInSeconds")
    if isinstance(resets_in, int) and resets_in > 0:
        message += f"; it resets in {_human_duration(resets_in)}"
    return message + ". Sign in with another ChatGPT account or pick a model from a different provider."


def _quota_detail(upstream: Any) -> tuple[str, int | None]:
    """The upstream's own explanation of a 429, and how long it says it lasts.

    The body of a plan-window rejection carries `resets_in_seconds`; the rate
    limit headers say the same for the window that is spent. Without it the
    account would rest for the default quarter hour and be re-benched every
    quarter hour for days, each time failing one request over to a sibling.

    The message names the window when that can be told. The backend's own
    sentence, "The usage limit has been reached", sent a reader to the
    five-hour meter — nearly empty — and left the three-day reset on a
    barely used account looking like a bug in the app.
    """
    message: str | None = None
    resets_in: int | None = None
    try:
        body = upstream.json()
        error = body.get("error") if isinstance(body, dict) else None
        if isinstance(error, dict):
            text = error.get("message")
            if isinstance(text, str) and text.strip():
                message = text.strip()[:300]
            resets_in = _positive_seconds(error.get("resets_in_seconds"))
    except Exception:
        pass
    snapshot = None
    try:
        snapshot = parse_rate_limit_headers(upstream.headers)
    except Exception:
        snapshot = None
    if resets_in is None and snapshot is not None:
        windows = [w for w in (snapshot.primary, snapshot.secondary) if w is not None]
        spent = [w for w in windows if (w.used_percent or 0) >= 100] or windows
        resets_in = next(
            (
                _positive_seconds(w.resets_in_seconds)
                for w in spent
                if _positive_seconds(w.resets_in_seconds) is not None
            ),
            None,
        )
    window = spent_window_message(resets_in, snapshot)
    if window is not None:
        message = window
    if message is None:
        message = (
            f"the plan's usage window is spent; it resets in about {resets_in // 3600}h"
            if resets_in is not None and resets_in >= 3600
            else "the plan's usage window is spent"
        )
    return message, resets_in


def _positive_seconds(value: Any) -> int | None:
    try:
        seconds = int(float(value))
    except (TypeError, ValueError):
        return None
    return seconds if seconds > 0 else None


def _retry_with_next_account(
    responses_payload: Dict[str, Any],
    session_id: str,
    *,
    stream: bool,
    exhausted: str,
):
    """One attempt on the next healthy account.

    Returns the normal ``(upstream, error_response)`` pair after an attempted
    handoff, or ``None`` when no replacement account exists. Keeping the error
    response is essential: a reset or read timeout on the replacement POST is
    acceptance-ambiguous and must not be disguised as the first account's
    deterministic 429.

    Deliberately not recursive: a second account that is also out records its
    own cooldown through the normal path on the following request, rather than
    walking every account inside a single call and stalling the caller.
    """
    try:
        replacement = select_account()
    except Exception:
        return None
    if replacement is None or replacement.key == exhausted:
        return None

    try:
        access_token, account_id = get_effective_chatgpt_auth(
            (replacement.auth, replacement.path)
        )
    except Exception:
        return None
    if not access_token or not account_id:
        return None

    headers = build_upstream_headers(
        access_token,
        account_id,
        session_id,
        accept=("text/event-stream" if stream else "application/json"),
    )
    connect_timeout = _env_float(
        "CHATMOCK_UPSTREAM_CONNECT_TIMEOUT", _DEFAULT_CONNECT_TIMEOUT_SECONDS, minimum=1.0, maximum=300.0
    )
    read_timeout = _env_float(
        "CHATMOCK_UPSTREAM_READ_TIMEOUT", _DEFAULT_READ_TIMEOUT_SECONDS, minimum=5.0, maximum=1800.0
    )
    try:
        upstream = requests.post(
            CHATGPT_RESPONSES_URL,
            headers=headers,
            json=responses_payload,
            stream=stream,
            timeout=(connect_timeout, read_timeout),
        )
    except requests.RequestException as exc:
        replay_safe = is_proven_preconnect_failure(exc)
        message = (
            "Upstream ChatGPT replacement account could not be reached before "
            f"the request was sent ({type(exc).__name__})."
            if replay_safe
            else (
                "Upstream ChatGPT replacement account request failed without "
                f"replay ({type(exc).__name__})."
            )
        )
        error_response = make_response(
            jsonify({"error": {"message": message}}),
            502,
        )
        for key, value in build_cors_headers().items():
            error_response.headers.setdefault(key, value)
        return None, error_response

    if getattr(upstream, "status_code", None) == 429:
        detail, resets_in = _quota_detail(upstream)
        _note_account_exhausted_quietly(replacement.key, reason=detail, seconds=resets_in)
        _close_quietly(upstream)
        return None
    _tag_account(upstream, replacement)
    return upstream, None


def build_upstream_websocket_url() -> str:
    parsed = urlparse(CHATGPT_RESPONSES_URL)
    scheme = parsed.scheme.lower()
    if scheme == "https":
        parsed = parsed._replace(scheme="wss")
    elif scheme == "http":
        parsed = parsed._replace(scheme="ws")
    return urlunparse(parsed)


def build_upstream_websocket_ssl_context() -> ssl.SSLContext:
    """Build the same explicit trust store for every ChatGPT websocket path."""

    cafile = (
        os.getenv("CODEX_CA_CERTIFICATE")
        or os.getenv("SSL_CERT_FILE")
        or certifi.where()
    )
    return ssl.create_default_context(cafile=cafile)


def connect_upstream_websocket(
    url: str,
    headers: Dict[str, str],
    *,
    open_timeout: float = 15.0,
    close_timeout: float = 10.0,
):
    """Open one authenticated Responses websocket with bounded handshakes.

    The caller owns the returned connection and must close it. Keeping this
    helper transport-only lets the public websocket proxy and the council use
    identical TLS/auth connection behavior while retaining different lifetime
    policies (session reuse for the proxy, exactly one response for council).
    """

    return websocket_connect(
        url,
        additional_headers=headers,
        open_timeout=open_timeout,
        close_timeout=close_timeout,
        max_size=upstream_websocket_max_message_bytes(),
        ssl=build_upstream_websocket_ssl_context(),
    )
