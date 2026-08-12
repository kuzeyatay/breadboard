from __future__ import annotations

"""Durable, secret-free telemetry for ChatMock model routing.

Clients intentionally send the ``default`` sentinel so a model choice can be
changed without restarting them.  Keeping only that sentinel in historical
logs makes it impossible to prove which provider/model served a request or
whether quota failover occurred.  This append-only JSONL ledger records one row
per upstream attempt and never stores prompts, responses, credentials, or URLs.
"""

import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict

from .utils import eprint, get_home_dir


MODEL_TELEMETRY_FILENAME = "model_routing.jsonl"
_lock = threading.Lock()


def telemetry_path() -> str:
    override = (os.getenv("CHATMOCK_MODEL_TELEMETRY_FILE") or "").strip()
    if override:
        return os.path.abspath(override)
    return os.path.abspath(os.path.join(get_home_dir(), MODEL_TELEMETRY_FILENAME))


def _clean(value: Any, limit: int = 300) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()[:limit]


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
) -> Dict[str, Any]:
    """Append and return one model-attempt record.

    Persistence is deliberately best-effort: telemetry must never turn a valid
    model response into an error.  The returned record is also attached to a
    Council run, so the run snapshot remains useful if the global ledger cannot
    be written.
    """

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
    }
    # Keep the line compact and make absence explicit only where it matters.
    entry = {key: value for key, value in entry.items() if value is not None}
    path = telemetry_path()
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        line = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
        with _lock:
            with open(path, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
    except OSError as exc:
        eprint(f"ERROR: unable to record model routing telemetry: {exc}")
    return entry
