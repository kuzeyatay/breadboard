"""Did OMH's awareness hook return a payload for model input?

`pre_llm_call` is how OMH gets its primer and route hint in front of Hermes.
Nothing recorded whether that ever happened:

- `host_observation` drops a record entirely unless the caller supplies `host`
  and `session_id`, and Hermes does not pass either to `pre_llm_call`. The
  ledger therefore stayed at eight `pre_verify` rows from a single day while
  live turns ran.
- Hermes wraps every hook callback in try/except and only logs a warning, so a
  hook that raises disappears without a user-visible trace.

Between those two, awareness could be dead for weeks and the only symptom would
be a user learning to type "load OMH" by hand. This records the one fact that
distinguishes those worlds.

The ledger observes the `pre_llm_call` hook returning injection content. It is
not host-consumption acknowledgement and does not prove a model received,
processed, or acted on that content.

Counters, not an append-only log. A per-turn log on the hottest path in the
system is how a journal reached ~4.7k rows of noise; a fixed-shape counter file
cannot grow.
"""

from __future__ import annotations

import json
import os
import secrets
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover - Hermes targets POSIX hosts today.
    fcntl = None


AWARENESS_DELIVERY_SCHEMA_VERSION = "omh_awareness_delivery/v1"
AWARENESS_DELIVERY_FILE = "awareness_delivery.json"


def _runtime_dir(omh_home: str = "") -> Path:
    root = Path(os.path.expandvars(omh_home or os.environ.get("OMH_HOME", "~/.omh"))).expanduser()
    return root / "runtime"


def awareness_delivery_path(omh_home: str = "") -> Path:
    return _runtime_dir(omh_home) / AWARENESS_DELIVERY_FILE


def read_awareness_delivery(omh_home: str = "") -> dict[str, Any]:
    """Current counters, or an empty record when nothing has been delivered."""
    try:
        data = json.loads(awareness_delivery_path(omh_home).read_text(encoding="utf-8"))
    except (FileNotFoundError, NotADirectoryError):
        return _empty()
    except (OSError, json.JSONDecodeError):
        return {**_empty(), "unreadable": True}
    if not isinstance(data, dict) or not _valid_delivery_record(data):
        return {**_empty(), "unreadable": True}
    return {**_empty(), **data}


def _empty() -> dict[str, Any]:
    return {
        "schema_version": AWARENESS_DELIVERY_SCHEMA_VERSION,
        "delivery_count": 0,
        "route_hint_count": 0,
        "suppressed_count": 0,
        "first_attempted_at": "",
        "first_delivered_at": "",
        "last_delivered_at": "",
        "last_context_chars": 0,
        "unreadable": False,
    }


def _valid_delivery_record(data: dict[str, Any]) -> bool:
    if data.get("schema_version") != AWARENESS_DELIVERY_SCHEMA_VERSION:
        return False
    for key in ("delivery_count", "route_hint_count", "suppressed_count", "last_context_chars"):
        value = data.get(key, 0)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            return False
    for key in ("first_attempted_at", "first_delivered_at", "last_delivered_at"):
        if not isinstance(data.get(key, ""), str):
            return False
    return int(data.get("route_hint_count", 0)) <= int(data.get("delivery_count", 0))


@contextmanager
def _awareness_delivery_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    lock_path = path.with_name(f".{path.name}.lock")
    lock_path.touch(mode=0o600, exist_ok=True)
    lock_path.chmod(0o600)
    with lock_path.open("a+", encoding="utf-8") as handle:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _write_delivery_record(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_name(f".{path.name}.{os.getpid()}-{secrets.token_hex(8)}.tmp")
    created = False
    try:
        with tmp.open("x", encoding="utf-8") as handle:
            created = True
            handle.write(json.dumps(data, indent=2, sort_keys=True) + "\n")
        tmp.chmod(0o600)
        tmp.replace(path)
        path.chmod(0o600)
    except OSError:
        if created and tmp.exists() and not tmp.is_symlink():
            tmp.unlink()
        raise


def record_awareness_delivery(
    *,
    delivered: bool,
    route_hint: bool,
    context_chars: int,
    observed_at: str,
    omh_home: str = "",
) -> dict[str, Any] | None:
    """Bump counters for one `pre_llm_call` hook result. Best-effort and metadata-only.

    Records that an injection payload was returned and how big it was, never what it said:
    the prompt and the hint text stay out of this file, as they stay out of
    every other OMH ledger.

    A write failure returns None rather than raising. Losing a counter is
    acceptable; breaking the hook that feeds the model is not.
    """
    path = awareness_delivery_path(omh_home)
    try:
        with _awareness_delivery_lock(path):
            current = read_awareness_delivery(omh_home)
            updated = {
                "schema_version": AWARENESS_DELIVERY_SCHEMA_VERSION,
                "delivery_count": int(current["delivery_count"]) + (1 if delivered else 0),
                "route_hint_count": int(current["route_hint_count"]) + (1 if route_hint else 0),
                "suppressed_count": int(current["suppressed_count"]) + (0 if delivered else 1),
                "first_attempted_at": current["first_attempted_at"] or observed_at,
                "first_delivered_at": current["first_delivered_at"] or (observed_at if delivered else ""),
                "last_delivered_at": observed_at if delivered else current["last_delivered_at"],
                "last_context_chars": (
                    max(0, int(context_chars)) if delivered else int(current["last_context_chars"])
                ),
            }
            _write_delivery_record(path, updated)
    except (OSError, TypeError, ValueError):
        return None
    return updated
