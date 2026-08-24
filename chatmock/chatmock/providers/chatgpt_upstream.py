from __future__ import annotations

import json
import math
import os
import re
import time
from typing import Any, Callable, Dict, List
from uuid import uuid4

from flask import request as flask_request

from ..accounts import ChatGptAccount, note_account_exhausted, select_account
from ..config import BASE_INSTRUCTIONS, GPT5_CODEX_INSTRUCTIONS
from ..limits import record_rate_limits_from_response
from ..model_telemetry import _create_quota_account_handoff
from ..model_registry import allowed_efforts_for_model, normalize_model_name, uses_codex_instructions
from ..reasoning import build_reasoning_param
from ..session import ensure_session_id
from ..upstream import (
    build_upstream_headers,
    build_upstream_websocket_url,
    connect_upstream_websocket,
)
from ..utils import convert_chat_messages_to_responses_input, get_effective_chatgpt_auth
from .types import ModelCall, ModelTokenUsage, ProviderError


# Council generations can legitimately spend more than fifteen minutes in one
# model call. Both deadlines remain finite, but their defaults sit above that
# observed boundary. The idle deadline resets on every upstream frame; the
# total deadline never does.
DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS = 1_200.0
DEFAULT_WEBSOCKET_TOTAL_TIMEOUT_SECONDS = 1_800.0
DEFAULT_WEBSOCKET_OPEN_TIMEOUT_SECONDS = 30.0
_MIN_CONFIGURED_STREAM_DEADLINE_SECONDS = 901.0
_MAX_CONFIGURED_STREAM_DEADLINE_SECONDS = 21_600.0
_SAFE_CODE_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


def _configured_stream_deadline(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    if not math.isfinite(value):
        return default
    return max(
        _MIN_CONFIGURED_STREAM_DEADLINE_SECONDS,
        min(_MAX_CONFIGURED_STREAM_DEADLINE_SECONDS, value),
    )


def _configured_open_timeout() -> float:
    try:
        value = float(
            os.getenv(
                "CHATMOCK_COUNCIL_WEBSOCKET_OPEN_TIMEOUT",
                str(DEFAULT_WEBSOCKET_OPEN_TIMEOUT_SECONDS),
            )
        )
    except (TypeError, ValueError):
        return DEFAULT_WEBSOCKET_OPEN_TIMEOUT_SECONDS
    if not math.isfinite(value):
        return DEFAULT_WEBSOCKET_OPEN_TIMEOUT_SECONDS
    return max(1.0, min(300.0, value))


def _positive_timeout(value: float | None, fallback: float) -> float:
    if value is None:
        return fallback
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if math.isfinite(parsed) and parsed > 0 else fallback


def _token_count(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return int(value)


def _responses_token_usage(value: Any) -> ModelTokenUsage | None:
    if not isinstance(value, dict):
        return None

    input_tokens = _token_count(value.get("input_tokens"))
    output_tokens = _token_count(value.get("output_tokens"))
    total_tokens = _token_count(value.get("total_tokens"))
    if input_tokens is None or output_tokens is None or total_tokens is None:
        return None

    input_details = value.get("input_tokens_details")
    output_details = value.get("output_tokens_details")
    cached_tokens = (
        _token_count(input_details.get("cached_tokens"))
        if isinstance(input_details, dict)
        else None
    )
    reasoning_tokens = (
        _token_count(output_details.get("reasoning_tokens"))
        if isinstance(output_details, dict)
        else None
    )
    return ModelTokenUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cached_input_tokens=cached_tokens or 0,
        reasoning_tokens=reasoning_tokens or 0,
    )


def _safe_code(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned if _SAFE_CODE_RE.fullmatch(cleaned) else None


def _status_code(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str) and value.isdigit():
        value = int(value)
    if isinstance(value, int) and 100 <= value <= 599:
        return value
    return None


def _event_status_code(event: Dict[str, Any]) -> int | None:
    candidates: list[Any] = [event.get("status_code"), event.get("status")]
    error = event.get("error")
    if isinstance(error, dict):
        candidates.extend((error.get("status_code"), error.get("status")))
    response = event.get("response")
    if isinstance(response, dict):
        candidates.append(response.get("status_code"))
        response_error = response.get("error")
        if isinstance(response_error, dict):
            candidates.extend(
                (response_error.get("status_code"), response_error.get("status"))
            )
    for candidate in candidates:
        parsed = _status_code(candidate)
        if parsed is not None:
            return parsed
    return None


def _event_error_code(event: Dict[str, Any]) -> str | None:
    error = event.get("error")
    if isinstance(error, dict):
        code = _safe_code(error.get("code"))
        if code:
            return code
    response = event.get("response")
    if isinstance(response, dict):
        response_error = response.get("error")
        if isinstance(response_error, dict):
            code = _safe_code(response_error.get("code"))
            if code:
                return code
        incomplete = response.get("incomplete_details")
        if isinstance(incomplete, dict):
            reason = _safe_code(incomplete.get("reason"))
            if reason:
                return reason
    return None


def _exception_status_code(exc: BaseException) -> int | None:
    response = getattr(exc, "response", None)
    return _status_code(getattr(response, "status_code", None)) or _status_code(
        getattr(exc, "status_code", None)
    )


def _websocket_close_code(exc: BaseException) -> int | None:
    """Extract only the protocol close code, never the upstream reason text."""

    current: BaseException | None = exc
    seen: set[int] = set()
    for _ in range(6):
        if current is None or id(current) in seen:
            break
        seen.add(id(current))
        for name in ("rcvd", "sent"):
            code = getattr(getattr(current, name, None), "code", None)
            if isinstance(code, int) and 1000 <= code <= 4999:
                return code
        code = getattr(current, "code", None)
        if isinstance(code, int) and 1000 <= code <= 4999:
            return code
        current = current.__cause__ or current.__context__
    return None


def _websocket_error_code(exc: BaseException) -> str:
    close_code = _websocket_close_code(exc)
    current: BaseException | None = exc
    seen: set[int] = set()
    payload_too_large = close_code == 1009
    for _ in range(6):
        if current is None or id(current) in seen:
            break
        seen.add(id(current))
        payload_too_large = payload_too_large or type(current).__name__ == "PayloadTooBig"
        current = current.__cause__ or current.__context__
    return "message_too_large" if payload_too_large else "connection_closed"


def _slot(event: Dict[str, Any]) -> tuple[int, int]:
    output_index = event.get("output_index")
    content_index = event.get("content_index")
    return (
        output_index if isinstance(output_index, int) else 0,
        content_index if isinstance(content_index, int) else 0,
    )


def _ordered_text(parts: Dict[tuple[int, int], str]) -> str:
    return "".join(parts[key] for key in sorted(parts))


def _response_output_text(response: Any) -> str:
    if not isinstance(response, dict):
        return ""
    pieces: list[str] = []
    output = response.get("output")
    if not isinstance(output, list):
        return ""
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "output_text":
                continue
            text = part.get("text")
            if isinstance(text, str):
                pieces.append(text)
    return "".join(pieces)


def _response_reasoning_text(response: Any) -> str:
    if not isinstance(response, dict):
        return ""
    pieces: list[str] = []
    output = response.get("output")
    if not isinstance(output, list):
        return ""
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "reasoning":
            continue
        for field in ("summary", "content"):
            parts = item.get(field)
            if not isinstance(parts, list):
                continue
            for part in parts:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if isinstance(text, str):
                    pieces.append(text)
    return "".join(pieces)


def _client_session_id() -> str | None:
    try:
        return (
            flask_request.headers.get("X-Session-Id")
            or flask_request.headers.get("session_id")
            or None
        )
    except Exception:
        return None


class ChatGptUpstreamProvider:
    """Council provider backed by one authenticated Responses websocket per call.

    A council answer may stream for far longer than an HTTP read timeout. A
    dedicated socket keeps healthy long responses alive while still bounding
    both silence and total lifetime. There is deliberately no internal replay:
    once ``response.create`` is sent, any close or protocol failure becomes a
    structured ``ProviderError`` for ProviderRouter to record and handle.
    """

    def __init__(
        self,
        reasoning_effort: str | None = None,
        reasoning_summary: str | None = None,
        *,
        idle_timeout_seconds: float | None = None,
        total_timeout_seconds: float | None = None,
        open_timeout_seconds: float | None = None,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self.reasoning_effort = (
            reasoning_effort
            or os.getenv("CHATGPT_LOCAL_REASONING_EFFORT", "medium").lower()
        )
        self.reasoning_summary = (
            reasoning_summary
            or os.getenv("CHATGPT_LOCAL_REASONING_SUMMARY", "auto").lower()
        )
        configured_idle = _configured_stream_deadline(
            "CHATMOCK_COUNCIL_WEBSOCKET_IDLE_TIMEOUT",
            DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS,
        )
        configured_total = _configured_stream_deadline(
            "CHATMOCK_COUNCIL_WEBSOCKET_TOTAL_TIMEOUT",
            DEFAULT_WEBSOCKET_TOTAL_TIMEOUT_SECONDS,
        )
        self.idle_timeout_seconds = _positive_timeout(
            idle_timeout_seconds, configured_idle
        )
        self.total_timeout_seconds = _positive_timeout(
            total_timeout_seconds, configured_total
        )
        self.open_timeout_seconds = _positive_timeout(
            open_timeout_seconds, _configured_open_timeout()
        )
        self._clock = clock or time.monotonic

    @staticmethod
    def _provider_error(
        model: str,
        description: str,
        *,
        status_code: int,
        phase: str,
        partial_output: bool,
        code: str,
        replay_safe: bool = False,
        upstream_code: str | None = None,
        elapsed_seconds: float | None = None,
        websocket_close_code: int | None = None,
    ) -> ProviderError:
        safe_suffix = f" ({upstream_code})" if upstream_code else ""
        return ProviderError(
            f"chatgpt upstream {description} for {model}{safe_suffix}",
            status_code=status_code,
            phase=phase,
            partial_output=partial_output,
            replay_safe=replay_safe,
            code=code,
            elapsed_seconds=elapsed_seconds,
            websocket_close_code=websocket_close_code,
        )

    @staticmethod
    def _note_quota(account: ChatGptAccount | None, status_code: int | None) -> None:
        if account is not None and status_code == 429:
            try:
                note_account_exhausted(
                    account.key,
                    reason="the upstream account returned HTTP 429",
                )
            except Exception:
                # Cooldown persistence is an observer. The terminal upstream
                # rejection remains authoritative if that observer is broken.
                pass

    @staticmethod
    def _replacement_account(
        account: ChatGptAccount | None,
        status_code: int | None,
        allow_account_failover: bool,
        *,
        replay_safe: bool,
    ) -> ChatGptAccount | None:
        if (
            not replay_safe
            or not allow_account_failover
            or status_code != 429
            or account is None
        ):
            return None
        try:
            replacement = select_account()
        except Exception:
            # Account selection is recovery control-plane state. Preserve the
            # explicit terminal 429 if that state cannot be read.
            return None
        if replacement is None or replacement.key == account.key:
            return None
        return replacement

    @staticmethod
    def _record_quota_account_handoff(
        call: ModelCall,
        *,
        previous: ChatGptAccount,
        replacement: ChatGptAccount,
        terminal_event: str,
        terminal_status: int,
        terminal_code: str | None,
        partial_output: bool,
    ) -> None:
        """Attach proof for one safe, explicit quota-account handoff.

        The receipt is deliberately fail-closed and observational. It is only
        created for a terminal 429 before any answer, never for a send/receive
        timeout or close. Account and request identities are one-way hashes; no
        token, path, email, or raw account key enters telemetry.
        """

        if terminal_status != 429 or partial_output:
            return
        if terminal_event not in {
            "websocket.handshake_rejected",
            "response.failed",
            "error",
        }:
            return
        try:
            handoff = _create_quota_account_handoff(
                request_id=call.request_id,
                previous_account_key=previous.key,
                replacement_account_key=replacement.key,
                terminal_event=terminal_event,
                terminal_status=terminal_status,
                terminal_code=terminal_code,
                partial_output=partial_output,
            )
            if handoff is not None:
                call.transport_recoveries_out.append(handoff)
        except Exception:
            # Audit output cannot interfere with the already-proven handoff.
            return

    def call_model(self, call: ModelCall) -> str:
        if not isinstance(call.request_id, str) or not call.request_id.strip():
            call.request_id = f"mreq_{uuid4().hex}"
        return self._call_model(
            call,
            account=None,
            allow_account_failover=call.allow_account_failover,
            started_at=self._clock(),
        )

    def _call_model(
        self,
        call: ModelCall,
        *,
        account: ChatGptAccount | None,
        allow_account_failover: bool,
        started_at: float,
    ) -> str:
        model = normalize_model_name(call.model)

        messages: List[Dict[str, Any]] = []
        if isinstance(call.system, str) and call.system.strip():
            messages.append({"role": "user", "content": call.system})
        for message in call.messages or []:
            if isinstance(message, dict) and message.get("role") == "system":
                messages.append({"role": "user", "content": message.get("content")})
            else:
                messages.append(message)

        input_items = convert_chat_messages_to_responses_input(messages)
        instructions = (
            GPT5_CODEX_INSTRUCTIONS
            if uses_codex_instructions(model)
            and isinstance(GPT5_CODEX_INSTRUCTIONS, str)
            and GPT5_CODEX_INSTRUCTIONS.strip()
            else BASE_INSTRUCTIONS
        )
        reasoning_overrides = {
            key: value
            for key, value in {
                "effort": call.reasoning_effort,
                "summary": call.reasoning_summary,
            }.items()
            if isinstance(value, str) and value.strip()
        }
        reasoning_param = build_reasoning_param(
            self.reasoning_effort,
            self.reasoning_summary,
            reasoning_overrides or None,
            allowed_efforts=allowed_efforts_for_model(model),
        )
        session_id = ensure_session_id(instructions, input_items, _client_session_id())
        payload: Dict[str, Any] = {
            "type": "response.create",
            "model": model,
            "instructions": instructions,
            "input": input_items,
            "tools": [],
            "tool_choice": "auto",
            "parallel_tool_calls": False,
            "store": False,
            "prompt_cache_key": session_id,
        }
        if reasoning_param is not None:
            payload["reasoning"] = reasoning_param
            # This is a one-shot, store=false council call. Encrypted reasoning
            # is only useful when a later request sends it back for continuity;
            # requesting it here bloats the terminal websocket frame while the
            # provider consumes only the streamed summary.
        payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

        account = account or select_account()
        selected_auth = (account.auth, account.path) if account is not None else None
        try:
            access_token, account_id = get_effective_chatgpt_auth(selected_auth)
        except Exception as exc:
            raise self._provider_error(
                model,
                "authentication failed",
                status_code=401,
                phase="auth",
                partial_output=False,
                replay_safe=True,
                code="authentication_error",
                elapsed_seconds=max(0.0, self._clock() - started_at),
            ) from exc
        if not access_token or not account_id:
            raise self._provider_error(
                model,
                "credentials are unavailable",
                status_code=401,
                phase="auth",
                partial_output=False,
                replay_safe=True,
                code="missing_credentials",
                elapsed_seconds=max(0.0, self._clock() - started_at),
            )

        headers = build_upstream_headers(
            access_token,
            account_id,
            session_id,
            accept="application/json",
        )
        upstream_ws = None
        text_parts: Dict[tuple[int, int], str] = {}
        reasoning_parts: Dict[tuple[int, int], str] = {}
        completed_response: Dict[str, Any] | None = None
        observed_output_event = False

        def has_partial_output() -> bool:
            return bool(
                observed_output_event
                or _ordered_text(text_parts)
                or _ordered_text(reasoning_parts)
            )

        try:
            connect_remaining = self.total_timeout_seconds - (
                self._clock() - started_at
            )
            if connect_remaining <= 0:
                raise self._provider_error(
                    model,
                    "websocket total timeout",
                    status_code=504,
                    phase="connect",
                    partial_output=False,
                    replay_safe=True,
                    code="total_timeout",
                    elapsed_seconds=max(0.0, self._clock() - started_at),
                )
            try:
                upstream_ws = connect_upstream_websocket(
                    build_upstream_websocket_url(),
                    headers,
                    open_timeout=min(self.open_timeout_seconds, connect_remaining),
                )
            except Exception as exc:
                if self._clock() - started_at >= self.total_timeout_seconds:
                    raise self._provider_error(
                        model,
                        "websocket total timeout",
                        status_code=504,
                        phase="connect",
                        partial_output=False,
                        replay_safe=True,
                        code="total_timeout",
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                    ) from exc
                status = _exception_status_code(exc) or 502
                self._note_quota(account, status)
                replacement = self._replacement_account(
                    account,
                    status,
                    allow_account_failover,
                    replay_safe=True,
                )
                if replacement is not None:
                    self._record_quota_account_handoff(
                        call,
                        previous=account,
                        replacement=replacement,
                        terminal_event="websocket.handshake_rejected",
                        terminal_status=status,
                        terminal_code=_safe_code(getattr(exc, "code", None)),
                        partial_output=False,
                    )
                    return self._call_model(
                        call,
                        account=replacement,
                        allow_account_failover=False,
                        started_at=started_at,
                    )
                raise self._provider_error(
                    model,
                    "websocket connection failed",
                    status_code=status,
                    phase="connect",
                    partial_output=False,
                    replay_safe=True,
                    code="connection_failed",
                    elapsed_seconds=max(0.0, self._clock() - started_at),
                ) from exc

            handshake_response = getattr(upstream_ws, "response", None)
            try:
                record_rate_limits_from_response(handshake_response or upstream_ws)
            except Exception:
                # Usage telemetry cannot prevent an otherwise valid request
                # from being sent or alter its eventual result.
                pass

            if self._clock() - started_at >= self.total_timeout_seconds:
                raise self._provider_error(
                    model,
                    "websocket total timeout",
                    status_code=504,
                    phase="connect",
                    partial_output=False,
                    replay_safe=True,
                    code="total_timeout",
                    elapsed_seconds=max(0.0, self._clock() - started_at),
                )

            try:
                upstream_ws.send(payload_json)
            except Exception as exc:
                raise self._provider_error(
                    model,
                    "websocket send failed",
                    status_code=502,
                    phase="send",
                    partial_output=False,
                    code="send_failed",
                    elapsed_seconds=max(0.0, self._clock() - started_at),
                ) from exc

            while True:
                elapsed = self._clock() - started_at
                total_remaining = self.total_timeout_seconds - elapsed
                if total_remaining <= 0:
                    raise self._provider_error(
                        model,
                        "websocket total timeout",
                        status_code=504,
                        phase="receive",
                        partial_output=has_partial_output(),
                        code="total_timeout",
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                    )
                receive_timeout = min(self.idle_timeout_seconds, total_remaining)
                timeout_code = (
                    "total_timeout"
                    if total_remaining <= self.idle_timeout_seconds
                    else "idle_timeout"
                )
                try:
                    raw_message = upstream_ws.recv(timeout=receive_timeout)
                except TimeoutError as exc:
                    description = (
                        "websocket total timeout"
                        if timeout_code == "total_timeout"
                        else "websocket idle timeout"
                    )
                    raise self._provider_error(
                        model,
                        description,
                        status_code=504,
                        phase="receive",
                        partial_output=has_partial_output(),
                        code=timeout_code,
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                    ) from exc
                except Exception as exc:
                    close_code = _websocket_close_code(exc)
                    error_code = _websocket_error_code(exc)
                    raise self._provider_error(
                        model,
                        "websocket closed before completion",
                        status_code=502,
                        phase="receive",
                        partial_output=has_partial_output(),
                        code=error_code,
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                        websocket_close_code=close_code,
                    ) from exc

                if raw_message is None:
                    raise self._provider_error(
                        model,
                        "websocket closed before completion",
                        status_code=502,
                        phase="receive",
                        partial_output=has_partial_output(),
                        code="connection_closed",
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                    )
                if self._clock() - started_at >= self.total_timeout_seconds:
                    raise self._provider_error(
                        model,
                        "websocket total timeout",
                        status_code=504,
                        phase="receive",
                        partial_output=has_partial_output(),
                        code="total_timeout",
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                    )

                if isinstance(raw_message, bytes):
                    try:
                        message_text = raw_message.decode("utf-8", errors="strict")
                    except UnicodeDecodeError as exc:
                        raise self._provider_error(
                            model,
                            "returned a malformed websocket frame",
                            status_code=502,
                            phase="protocol",
                            partial_output=has_partial_output(),
                            code="malformed_frame",
                            elapsed_seconds=max(0.0, self._clock() - started_at),
                        ) from exc
                elif isinstance(raw_message, str):
                    message_text = raw_message
                else:
                    raise self._provider_error(
                        model,
                        "returned a malformed websocket frame",
                        status_code=502,
                        phase="protocol",
                        partial_output=has_partial_output(),
                        code="malformed_frame",
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                    )
                try:
                    event = json.loads(message_text)
                except json.JSONDecodeError as exc:
                    raise self._provider_error(
                        model,
                        "returned a malformed websocket frame",
                        status_code=502,
                        phase="protocol",
                        partial_output=has_partial_output(),
                        code="malformed_frame",
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                    ) from exc
                if not isinstance(event, dict):
                    raise self._provider_error(
                        model,
                        "returned a malformed websocket event",
                        status_code=502,
                        phase="protocol",
                        partial_output=has_partial_output(),
                        code="malformed_event",
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                    )

                kind = event.get("type")
                response = event.get("response")
                if isinstance(kind, str) and (
                    kind.startswith("response.output_")
                    or kind.startswith("response.reasoning_")
                    or kind.startswith("response.content_part.")
                ):
                    # Even an event shape this collector does not render proves
                    # the answer began. A later 429 must not replay it merely
                    # because its text arrived in an unfamiliar event variant.
                    observed_output_event = True
                if kind in (
                    "response.completed",
                    "response.incomplete",
                    "response.failed",
                ) and isinstance(response, dict):
                    call.usage_out = _responses_token_usage(response.get("usage"))

                if kind == "response.output_text.delta":
                    delta = event.get("delta")
                    if isinstance(delta, str):
                        key = _slot(event)
                        text_parts[key] = text_parts.get(key, "") + delta
                elif kind == "response.output_text.done":
                    text = event.get("text")
                    key = _slot(event)
                    if isinstance(text, str) and not text_parts.get(key):
                        text_parts[key] = text
                elif kind in (
                    "response.reasoning_summary_text.delta",
                    "response.reasoning_text.delta",
                ):
                    delta = event.get("delta")
                    if isinstance(delta, str):
                        key = _slot(event)
                        reasoning_parts[key] = reasoning_parts.get(key, "") + delta
                elif kind in (
                    "response.reasoning_summary_text.done",
                    "response.reasoning_text.done",
                ):
                    text = event.get("text")
                    key = _slot(event)
                    if isinstance(text, str) and not reasoning_parts.get(key):
                        reasoning_parts[key] = text
                elif kind == "response.failed":
                    status = _event_status_code(event) or 502
                    upstream_code = _event_error_code(event)
                    partial_output = bool(
                        has_partial_output()
                        or _response_output_text(response)
                        or _response_reasoning_text(response)
                    )
                    self._note_quota(account, status)
                    replacement = self._replacement_account(
                        account,
                        status,
                        allow_account_failover,
                        replay_safe=not partial_output,
                    )
                    if replacement is not None:
                        self._record_quota_account_handoff(
                            call,
                            previous=account,
                            replacement=replacement,
                            terminal_event="response.failed",
                            terminal_status=status,
                            terminal_code=upstream_code,
                            partial_output=partial_output,
                        )
                        try:
                            upstream_ws.close()
                        except Exception:
                            pass
                        upstream_ws = None
                        return self._call_model(
                            call,
                            account=replacement,
                            allow_account_failover=False,
                            started_at=started_at,
                        )
                    raise self._provider_error(
                        model,
                        "response failed",
                        status_code=status,
                        phase="upstream",
                        partial_output=partial_output,
                        replay_safe=not partial_output,
                        code="response_failed",
                        upstream_code=upstream_code,
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                    )
                elif kind == "response.incomplete":
                    # Responses API treats an incomplete response (for example,
                    # max_output_tokens) as a terminal response carrying usable
                    # partial output and usage, not as response.failed. Preserve
                    # that distinction while making it terminal on a websocket,
                    # which has no SSE [DONE] marker after it.
                    completed_response = response if isinstance(response, dict) else {}
                    break
                elif kind == "error":
                    status = _event_status_code(event) or 502
                    upstream_code = _event_error_code(event)
                    partial_output = bool(
                        has_partial_output()
                        or _response_output_text(response)
                        or _response_reasoning_text(response)
                    )
                    self._note_quota(account, status)
                    replacement = self._replacement_account(
                        account,
                        status,
                        allow_account_failover,
                        replay_safe=not partial_output,
                    )
                    if replacement is not None:
                        self._record_quota_account_handoff(
                            call,
                            previous=account,
                            replacement=replacement,
                            terminal_event="error",
                            terminal_status=status,
                            terminal_code=upstream_code,
                            partial_output=partial_output,
                        )
                        try:
                            upstream_ws.close()
                        except Exception:
                            pass
                        upstream_ws = None
                        return self._call_model(
                            call,
                            account=replacement,
                            allow_account_failover=False,
                            started_at=started_at,
                        )
                    raise self._provider_error(
                        model,
                        "returned an error event",
                        status_code=status,
                        phase="upstream",
                        partial_output=partial_output,
                        replay_safe=not partial_output,
                        code="error_event",
                        upstream_code=upstream_code,
                        elapsed_seconds=max(0.0, self._clock() - started_at),
                    )
                elif kind == "response.completed":
                    completed_response = response if isinstance(response, dict) else {}
                    break
        finally:
            if upstream_ws is not None:
                try:
                    upstream_ws.close()
                except Exception:
                    pass

        full_text = _ordered_text(text_parts)
        if not full_text:
            full_text = _response_output_text(completed_response)
        reasoning_text = _ordered_text(reasoning_parts)
        if not reasoning_text:
            reasoning_text = _response_reasoning_text(completed_response)
        if reasoning_text.strip():
            call.reasoning_out = reasoning_text.strip()
        return full_text
