from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse, urlunparse

import requests
from flask import Response, current_app, jsonify, make_response

from .config import CHATGPT_RESPONSES_URL
from .http import build_cors_headers
from .model_registry import normalize_model_name
from .session import ensure_session_id
from flask import request as flask_request
from .utils import get_effective_chatgpt_auth


_RETRYABLE_UPSTREAM_STATUS_CODES = frozenset({502, 503, 504})
_DEFAULT_CONNECT_TIMEOUT_SECONDS = 30.0
_DEFAULT_READ_TIMEOUT_SECONDS = 120.0
_DEFAULT_MAX_ATTEMPTS = 3
_DEFAULT_RETRY_BACKOFF_SECONDS = 1.0


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


def _close_quietly(response: Any) -> None:
    try:
        response.close()
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
):
    access_token, account_id = get_effective_chatgpt_auth()
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
):
    access_token, account_id = get_effective_chatgpt_auth()
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
    max_attempts = _env_int(
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
            if attempt < max_attempts:
                delay = _retry_delay_seconds(retry_backoff, attempt)
                _log_upstream_retry(type(exc).__name__, attempt, max_attempts, delay)
                if delay > 0:
                    time.sleep(delay)
                continue
            message = (
                f"Upstream ChatGPT request failed after {max_attempts} attempts: "
                f"{type(exc).__name__}: {exc}"
            )
            resp = make_response(jsonify({"error": {"message": message}}), 502)
            for key, value in build_cors_headers().items():
                resp.headers.setdefault(key, value)
            return None, resp

        status_code = getattr(upstream, "status_code", None)
        if status_code in _RETRYABLE_UPSTREAM_STATUS_CODES and attempt < max_attempts:
            _close_quietly(upstream)
            delay = _retry_delay_seconds(retry_backoff, attempt)
            _log_upstream_retry(f"returned HTTP {status_code}", attempt, max_attempts, delay)
            if delay > 0:
                time.sleep(delay)
            continue
        return upstream, None

    raise AssertionError("upstream retry loop ended unexpectedly")


def build_upstream_websocket_url() -> str:
    parsed = urlparse(CHATGPT_RESPONSES_URL)
    scheme = parsed.scheme.lower()
    if scheme == "https":
        parsed = parsed._replace(scheme="wss")
    elif scheme == "http":
        parsed = parsed._replace(scheme="ws")
    return urlunparse(parsed)
