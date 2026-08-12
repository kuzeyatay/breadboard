from __future__ import annotations

"""Quota failover: keep working when the preferred model runs out.

A ChatGPT plan's weekly Codex window can be exhausted for days. Before this,
that surfaced as an HTTP 429 on every request — the background model kept
pointing at a model that could not answer, and each subsystem failed
separately with a message nobody connected to "the plan is out".

Instead, an exhausted model is put on a cooldown and `default` resolves past it
to the next healthy one. The choice is not silently rewritten: the cooldown is
recorded with its reason and expiry so the dashboard can say which model is
unavailable, what is being used instead, and when the original returns.

State lives beside the other ChatMock state in the home directory, so a restart
does not lose a cooldown and re-hammer an exhausted upstream.

Deliberately outside ``providers/``: the account layer needs it, and importing
it from there would pull in the provider package, which imports the ChatGPT
upstream, which imports the account layer.
"""

import json
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List

from .utils import eprint, get_home_dir

FAILOVER_FILENAME = "model_failover.json"

# Used when an upstream reports exhaustion without saying for how long. Long
# enough not to hammer a rejecting endpoint, short enough that recovery is
# noticed the same session.
DEFAULT_COOLDOWN_SECONDS = 15 * 60
# A plan-level window can be days; never hold a cooldown longer than this
# without re-checking, so a reset is not missed because of a bad header.
MAX_COOLDOWN_SECONDS = 7 * 24 * 60 * 60

# Upstreams disagree on wording, and several report exhaustion as a plain 400.
_QUOTA_PATTERNS = (
    "usage limit",
    "rate limit",
    "quota",
    "insufficient_quota",
    "too many requests",
    "extra usage",
    "exceeded your current",
    "out of credit",
)


@dataclass(frozen=True)
class ModelCooldown:
    model: str
    reason: str
    until: float
    started: float

    @property
    def remaining_seconds(self) -> int:
        return max(0, int(self.until - time.time()))

    def to_json(self) -> Dict[str, Any]:
        return {
            "model": self.model,
            "reason": self.reason,
            "until": self.until,
            "started": self.started,
        }

    @classmethod
    def from_json(cls, value: Any) -> "ModelCooldown | None":
        if not isinstance(value, dict):
            return None
        model = value.get("model")
        until = value.get("until")
        if not isinstance(model, str) or not isinstance(until, (int, float)):
            return None
        return cls(
            model=model,
            reason=value.get("reason") if isinstance(value.get("reason"), str) else "",
            until=float(until),
            started=float(value.get("started") or 0.0),
        )


def is_quota_error(status_code: int | None, message: str | None) -> bool:
    """Whether a failed call means "this model is out", not "this call failed".

    A 429 is unambiguous. Everything else has to be read from the message,
    because some upstreams return plan exhaustion as a 400 with prose.
    """
    if status_code == 429:
        return True
    if status_code is not None and status_code not in (400, 402, 403):
        return False
    text = (message or "").lower()
    return any(pattern in text for pattern in _QUOTA_PATTERNS)


def retry_after_seconds(message: str | None) -> int | None:
    """Best-effort expiry from an upstream's prose, e.g. "try again in 3h"."""
    if not message:
        return None
    match = re.search(r"(\d+)\s*(second|minute|hour|day)s?", message.lower())
    if not match:
        return None
    amount = int(match.group(1))
    unit = match.group(2)
    scale = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}[unit]
    return min(MAX_COOLDOWN_SECONDS, amount * scale)


def _path() -> str:
    override = (os.getenv("CHATMOCK_FAILOVER_FILE") or "").strip()
    if override:
        return os.path.abspath(override)
    return os.path.abspath(os.path.join(get_home_dir(), FAILOVER_FILENAME))


_lock = threading.Lock()


def _read_all() -> Dict[str, ModelCooldown]:
    try:
        with open(_path(), "r", encoding="utf-8") as fp:
            raw = json.load(fp)
    except (OSError, ValueError, TypeError):
        return {}

    entries = raw.get("cooldowns") if isinstance(raw, dict) else None
    if not isinstance(entries, list):
        return {}

    now = time.time()
    out: Dict[str, ModelCooldown] = {}
    for entry in entries:
        cooldown = ModelCooldown.from_json(entry)
        # Expired entries are dropped on read, so recovery needs no sweeper.
        if cooldown is not None and cooldown.until > now:
            out[cooldown.model] = cooldown
    return out


def _write_all(cooldowns: Dict[str, ModelCooldown]) -> None:
    path = _path()
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as fp:
            json.dump(
                {"cooldowns": [cooldown.to_json() for cooldown in cooldowns.values()]},
                fp,
                indent=2,
            )
    except OSError as exc:
        eprint(f"ERROR: unable to record model failover state: {exc}")


def note_exhausted(
    model: str,
    *,
    reason: str = "",
    seconds: int | None = None,
) -> ModelCooldown | None:
    """Put a model on cooldown after an upstream said it is out of quota."""
    cleaned = (model or "").strip()
    if not cleaned:
        return None

    duration = seconds if seconds and seconds > 0 else retry_after_seconds(reason)
    duration = min(MAX_COOLDOWN_SECONDS, duration or DEFAULT_COOLDOWN_SECONDS)

    now = time.time()
    cooldown = ModelCooldown(
        model=cleaned,
        reason=(reason or "").strip()[:300],
        until=now + duration,
        started=now,
    )
    with _lock:
        cooldowns = _read_all()
        existing = cooldowns.get(cleaned)
        # Keep the longer of the two: a plan-level window outlives a short retry.
        if existing is None or cooldown.until > existing.until:
            cooldowns[cleaned] = cooldown
        else:
            cooldown = existing
        _write_all(cooldowns)
    return cooldown


def clear(model: str) -> None:
    with _lock:
        cooldowns = _read_all()
        if cooldowns.pop((model or "").strip(), None) is not None:
            _write_all(cooldowns)


def clear_all() -> None:
    with _lock:
        _write_all({})


def is_cooling(model: str) -> bool:
    return (model or "").strip() in _read_all()


def cooldown_for(model: str) -> ModelCooldown | None:
    return _read_all().get((model or "").strip())


def active_cooldowns() -> List[ModelCooldown]:
    return sorted(_read_all().values(), key=lambda cooldown: cooldown.until)
