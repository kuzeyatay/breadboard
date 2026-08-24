from __future__ import annotations

"""Durable, secret-free telemetry for ChatMock model routing.

Clients intentionally send the ``default`` sentinel so a model choice can be
changed without restarting them.  Keeping only that sentinel in historical
logs makes it impossible to prove which provider/model served a request or
whether quota failover occurred.  This append-only JSONL ledger records one row
per upstream attempt and never stores prompts, responses, credentials, or URLs.
"""

import hashlib
import hmac
import json
import math
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from typing import Any, Dict

from .utils import eprint, get_home_dir


MODEL_TELEMETRY_FILENAME = "model_routing.jsonl"
_lock = threading.Lock()
_TRANSPORT_RECEIPT_SIGNING_KEY = secrets.token_bytes(32)
_SAFE_RECEIPT_CODE_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
_QUOTA_HANDOFF_SIGNED_FIELDS = (
    "type",
    "evidence",
    "accepted",
    "replaySafe",
    "partialOutput",
    "terminalEvent",
    "terminalStatus",
    "terminalCode",
    "requestHash",
    "fromAccountHash",
    "toAccountHash",
)


def telemetry_path() -> str:
    override = (os.getenv("CHATMOCK_MODEL_TELEMETRY_FILE") or "").strip()
    if override:
        return os.path.abspath(override)
    return os.path.abspath(os.path.join(get_home_dir(), MODEL_TELEMETRY_FILENAME))


def _clean(value: Any, limit: int = 300) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        cleaned = value.strip()
        return cleaned[:limit] if cleaned else None
    except Exception:
        # Telemetry is an observer. Even a hostile string subclass must not
        # replace the model result it was supposed to describe.
        return None


def secret_free_audit_hash(namespace: str, value: Any) -> str | None:
    """Stable one-way identifier for request/account audit correlation."""

    if not isinstance(namespace, str) or not namespace.strip():
        return None
    cleaned = _clean(value, 1_000)
    if cleaned is None:
        return None
    material = f"chatmock-audit-v1\0{namespace.strip()}\0{cleaned}"
    return hashlib.sha256(material.encode("utf-8", errors="surrogatepass")).hexdigest()


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _quota_handoff_auth_tag(handoff: Dict[str, Any]) -> str:
    """Authenticate the exact secret-free handoff fields for this process."""

    canonical = json.dumps(
        {field: handoff.get(field) for field in _QUOTA_HANDOFF_SIGNED_FIELDS},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hmac.new(
        _TRANSPORT_RECEIPT_SIGNING_KEY,
        canonical,
        hashlib.sha256,
    ).hexdigest()


def _create_quota_account_handoff(
    *,
    request_id: Any,
    previous_account_key: Any,
    replacement_account_key: Any,
    terminal_event: Any,
    terminal_status: Any,
    terminal_code: Any,
    partial_output: bool,
) -> Dict[str, Any] | None:
    """Create the only authenticated quota-handoff evidence accepted here.

    Raw request and account identities are hashed before the row is built. The
    HMAC tag is process-private provenance: callers can reproduce the public
    hashes, but they cannot make a shape-compatible object authoritative. The
    validator removes the tag before anything reaches Council or JSONL.
    """

    allowed_terminal_events = {
        "websocket.handshake_rejected",
        "response.failed",
        "error",
    }
    if (
        terminal_status != 429
        or partial_output is not False
        or terminal_event not in allowed_terminal_events
    ):
        return None
    safe_terminal_code = _clean(terminal_code, 80) or "http_429"
    if _SAFE_RECEIPT_CODE_RE.fullmatch(safe_terminal_code) is None:
        safe_terminal_code = "http_429"

    request_hash = secret_free_audit_hash("model-request", request_id)
    from_hash = secret_free_audit_hash("chatgpt-account", previous_account_key)
    to_hash = secret_free_audit_hash("chatgpt-account", replacement_account_key)
    if (
        request_hash is None
        or from_hash is None
        or to_hash is None
        or from_hash == to_hash
    ):
        return None

    handoff: Dict[str, Any] = {
        "type": "quota_account_handoff",
        "evidence": "explicit_terminal_quota_rejection",
        "accepted": False,
        "replaySafe": True,
        "partialOutput": False,
        "terminalEvent": terminal_event,
        "terminalStatus": 429,
        "terminalCode": safe_terminal_code,
        "requestHash": request_hash,
        "fromAccountHash": from_hash,
        "toAccountHash": to_hash,
    }
    handoff["_authTag"] = _quota_handoff_auth_tag(handoff)
    return handoff


def _transport_recovery_receipt(
    recoveries: Any,
    *,
    recovered: bool,
    request_id: str | None,
) -> Dict[str, Any] | None:
    """Validate request-bound quota handoffs into a secret-free receipt.

    Historical recovery rows were accepted on shape alone, even though no live
    provider produced them. That made a fabricated object look authoritative.
    Only the production quota-account handoff contract is recognized now, and
    its request hash must match the enclosing model-attempt request id.
    """

    if not isinstance(recoveries, list):
        return None
    rows = [row for row in recoveries[:4] if isinstance(row, dict)]
    if not rows:
        return None
    expected_request_hash = secret_free_audit_hash("model-request", request_id)
    if expected_request_hash is None:
        return None

    allowed_terminal_events = {
        "websocket.handshake_rejected",
        "response.failed",
        "error",
    }
    handoffs: list[Dict[str, Any]] = []
    accepted_tags: set[str] = set()
    for row in rows:
        terminal_event = _clean(row.get("terminalEvent"), 80)
        terminal_code = _clean(row.get("terminalCode"), 80)
        from_hash = _clean(row.get("fromAccountHash"), 64)
        to_hash = _clean(row.get("toAccountHash"), 64)
        request_hash = _clean(row.get("requestHash"), 64)
        auth_tag = _clean(row.get("_authTag"), 64)
        if (
            row.get("type") != "quota_account_handoff"
            or row.get("evidence") != "explicit_terminal_quota_rejection"
            or row.get("accepted") is not False
            or row.get("replaySafe") is not True
            or row.get("partialOutput") is not False
            or row.get("terminalStatus") != 429
            or terminal_event not in allowed_terminal_events
            or terminal_code is None
            or request_hash != expected_request_hash
            or not _is_sha256(from_hash)
            or not _is_sha256(to_hash)
            or from_hash == to_hash
            or not _is_sha256(auth_tag)
        ):
            continue
        handoff = {
            "type": "quota_account_handoff",
            "evidence": "explicit_terminal_quota_rejection",
            "accepted": False,
            "replaySafe": True,
            "partialOutput": False,
            "terminalEvent": terminal_event,
            "terminalStatus": 429,
            "terminalCode": terminal_code,
            "requestHash": request_hash,
            "fromAccountHash": from_hash,
            "toAccountHash": to_hash,
        }
        expected_tag = _quota_handoff_auth_tag(handoff)
        if not hmac.compare_digest(auth_tag, expected_tag):
            continue
        # The production provider permits one account handoff. Avoid letting a
        # copied in-memory row inflate the durable receipt's count.
        if auth_tag in accepted_tags:
            continue
        accepted_tags.add(auth_tag)
        handoffs.append(handoff)

    if not handoffs:
        return None
    return {
        "count": len(handoffs),
        "types": ["quota_account_handoff"],
        "recovered": bool(recovered),
        "quotaAccountHandoffs": handoffs,
    }


def record_model_attempt(
    *,
    request_id: str | None,
    endpoint: str,
    requested_model: str | None,
    resolved_model: str,
    upstream_model: str,
    provider: str,
    outcome: str,
    fallback: bool,
    client_requested_model: str | None = None,
    status_code: int | None = None,
    error: str | None = None,
    failure_phase: str | None = None,
    partial_output: bool | None = None,
    replay_safe: bool | None = None,
    error_code: str | None = None,
    elapsed_seconds: float | None = None,
    websocket_close_code: int | None = None,
    transport_recoveries: Any = None,
    transport_recovered: bool = False,
) -> Dict[str, Any]:
    """Append and return one model-attempt record.

    Persistence is deliberately best-effort: telemetry must never turn a valid
    model response into an error.  The returned record is also attached to a
    Council run, so the run snapshot remains useful if the global ledger cannot
    be written.
    """

    try:
        transport_recovery = _transport_recovery_receipt(
            transport_recoveries,
            recovered=transport_recovered,
            request_id=request_id,
        )
    except Exception:
        transport_recovery = None

    entry: Dict[str, Any] = {
        "schemaVersion": 1,
        "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "requestId": _clean(request_id, 160),
        "endpoint": _clean(endpoint, 80) or "unknown",
        # `requestedModel` is always the outer client value so a `default`
        # sentinel remains visible. Council's internal seat model is separate.
        "requestedModel": _clean(client_requested_model) or _clean(requested_model),
        "callModel": (
            _clean(requested_model)
            if _clean(client_requested_model)
            and _clean(requested_model) != _clean(client_requested_model)
            else None
        ),
        "resolvedModel": _clean(resolved_model),
        "upstreamModel": _clean(upstream_model),
        "provider": _clean(provider, 80),
        "outcome": _clean(outcome, 40) or "unknown",
        "fallback": bool(fallback),
        "statusCode": status_code if isinstance(status_code, int) else None,
        "error": _clean(error),
        "failurePhase": _clean(failure_phase, 80),
        "partialOutput": (
            bool(partial_output) if isinstance(partial_output, bool) else None
        ),
        "replaySafe": (
            bool(replay_safe) if isinstance(replay_safe, bool) else None
        ),
        "errorCode": _clean(error_code, 80),
        "websocketCloseCode": (
            websocket_close_code
            if isinstance(websocket_close_code, int)
            and not isinstance(websocket_close_code, bool)
            and 1000 <= websocket_close_code <= 4999
            else None
        ),
        "elapsedSeconds": (
            round(float(elapsed_seconds), 3)
            if isinstance(elapsed_seconds, (int, float))
            and not isinstance(elapsed_seconds, bool)
            and math.isfinite(elapsed_seconds)
            and elapsed_seconds >= 0
            else None
        ),
        "transportRecovery": transport_recovery,
    }
    # Keep the line compact and make absence explicit only where it matters.
    entry = {key: value for key, value in entry.items() if value is not None}
    try:
        path = telemetry_path()
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        # ASCII escaping keeps lone Unicode surrogates in provider/model labels
        # representable on every filesystem encoding.
        line = json.dumps(entry, ensure_ascii=True, separators=(",", ":"))
        with _lock:
            with open(path, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
    except Exception as exc:
        try:
            eprint(
                "ERROR: unable to record model routing telemetry "
                f"({type(exc).__name__})"
            )
        except Exception:
            pass
    return entry
