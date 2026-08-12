from __future__ import annotations

"""Vendor health: stop asking a provider that is currently down.

This is the sibling of ``failover``, and the distinction between them is the
whole point:

* ``failover`` tracks a **model** that is *out of quota*. The provider is fine,
  the plan window is spent, and the cooldown is long — hours or days — so it is
  written to disk and survives a restart.
* This module tracks a **provider** that is *failing*. Nothing is exhausted;
  the endpoint is refusing connections, timing out, or returning 5xx. That is
  usually over in seconds or minutes.

Before this, a provider having a bad ten minutes produced one full retry ladder
per request, every request, each ending in the same error after the same wait.
The transport already retries within a call, which is right — but nothing
remembered across calls that the last four had all failed the same way, so the
tenth request paid the same cost as the first to learn the same thing.

Now a provider that fails repeatedly is put on a short, backing-off cooldown and
routing steps over it to a healthy model, the way an exhausted model already is.
Three properties keep that from doing more harm than good:

* **A single failure trips nothing.** It takes several consecutive failures, so
  one flaky call cannot reroute a user's chosen model out from under them.
* **The cooldown backs off and is capped.** Repeated trips lengthen it (30s,
  60s, 120s, …) up to ten minutes, so a long outage is not re-probed constantly
  and a recovered provider is never held out for long.
* **One success clears everything.** Health is proven by use, not by a timer,
  so recovery is immediate rather than waiting out a cooldown that is no longer
  true.

State is deliberately **in memory**. A transient outage rarely outlives the
process, and a restart is exactly the moment you want to re-probe rather than
inherit a stale verdict — the opposite of the quota case, which is why that one
is on disk and this one is not.
"""

import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List

# One bad call is noise. Several in a row is a pattern worth acting on.
FAILURES_BEFORE_COOLDOWN = 3
# First cooldown after tripping. Long enough to stop the bleeding, short enough
# that a blip is not punished.
BASE_COOLDOWN_SECONDS = 30
# A provider is never held out longer than this without being tried again — a
# recovered endpoint should not stay dark because it was down a while ago.
MAX_COOLDOWN_SECONDS = 10 * 60

# Wording differs by provider, so the shape of the failure is read from the
# message as well as the status. These are all "the endpoint is not working
# right now", never "your request was wrong".
_TRANSIENT_PATTERNS = (
    "could not be reached",
    "kept failing",
    "is unreachable",
    "timed out",
    "timeout",
    "connection",
    "temporarily unavailable",
    "service unavailable",
    "bad gateway",
    "overloaded",
    "internal server error",
)

# 5xx is the server's own admission. 408 and 504 are the two timeouts a proxy
# in front of it reports. Nothing in 4xx otherwise belongs here: a 401 means the
# key is wrong and a 400 means the request is, and neither improves by waiting.
_TRANSIENT_STATUSES = frozenset({408, 502, 503, 504, 522, 524})


@dataclass(frozen=True)
class ProviderOutage:
    provider: str
    reason: str
    until: float
    started: float
    consecutive_failures: int

    @property
    def remaining_seconds(self) -> int:
        return max(0, int(self.until - time.time()))

    def to_json(self) -> Dict[str, Any]:
        return {
            "provider": self.provider,
            "reason": self.reason,
            "consecutiveFailures": self.consecutive_failures,
            "resetsInSeconds": self.remaining_seconds,
        }


def is_transient_error(status_code: int | None, message: str | None) -> bool:
    """Whether a failure means "try again later", not "this call was wrong".

    A quota error is explicitly *not* transient: the model is out, which
    ``failover`` already handles with a far longer cooldown, and treating it as
    a provider outage would blame the wrong thing and recover far too early.
    """
    from . import failover

    if failover.is_quota_error(status_code, message):
        return False
    if status_code is not None:
        if status_code in _TRANSIENT_STATUSES:
            return True
        if 500 <= status_code < 600:
            return True
        # A status we were given and that is not transient settles it — the
        # prose below would otherwise read "connection" out of an unrelated
        # 400 about a connection parameter.
        return False
    text = (message or "").lower()
    return any(pattern in text for pattern in _TRANSIENT_PATTERNS)


@dataclass
class _Health:
    consecutive_failures: int = 0
    until: float = 0.0
    started: float = 0.0
    reason: str = ""
    # How many times this provider has tripped without a success in between,
    # which is what makes the next cooldown longer than the last.
    trips: int = 0


_lock = threading.Lock()
_state: Dict[str, _Health] = {}


def _cooldown_seconds(trips: int) -> int:
    return min(MAX_COOLDOWN_SECONDS, BASE_COOLDOWN_SECONDS * (2 ** max(0, trips - 1)))


def note_failure(
    provider: str,
    *,
    reason: str = "",
    status_code: int | None = None,
) -> ProviderOutage | None:
    """Record one failed call, and cool the provider down once it is a pattern.

    Returns the outage when this call is the one that trips it (or extends an
    existing one), and None while the provider is still within its allowance.
    Callers use that to decide whether to reroute *this* request: reacting
    before the threshold would make a single blip visible to the user.
    """
    cleaned = (provider or "").strip()
    if not cleaned or not is_transient_error(status_code, reason):
        return None

    now = time.time()
    with _lock:
        health = _state.setdefault(cleaned, _Health())
        health.consecutive_failures += 1
        health.reason = (reason or "").strip()[:300]
        if health.consecutive_failures < FAILURES_BEFORE_COOLDOWN:
            return None
        health.trips += 1
        health.started = now
        health.until = now + _cooldown_seconds(health.trips)
        return _outage(cleaned, health)


def note_success(provider: str) -> None:
    """Forget everything about a provider that just worked.

    Recovery is proven by a successful call rather than by a timer expiring,
    so a provider that comes back mid-cooldown is usable again immediately —
    including its accumulated backoff, which would otherwise punish it for an
    outage that is over.
    """
    cleaned = (provider or "").strip()
    if not cleaned:
        return
    with _lock:
        _state.pop(cleaned, None)


def is_unhealthy(provider: str) -> bool:
    return outage_for(provider) is not None


def outage_for(provider: str) -> ProviderOutage | None:
    cleaned = (provider or "").strip()
    if not cleaned:
        return None
    now = time.time()
    with _lock:
        health = _state.get(cleaned)
        if health is None or health.until <= now:
            return None
        return _outage(cleaned, health)


def active_outages() -> List[ProviderOutage]:
    now = time.time()
    with _lock:
        return sorted(
            (
                _outage(provider, health)
                for provider, health in _state.items()
                if health.until > now
            ),
            key=lambda outage: outage.until,
        )


def reset() -> None:
    """Forget all health state. For tests and for an explicit "try again now"."""
    with _lock:
        _state.clear()


def _outage(provider: str, health: _Health) -> ProviderOutage:
    return ProviderOutage(
        provider=provider,
        reason=health.reason,
        until=health.until,
        started=health.started,
        consecutive_failures=health.consecutive_failures,
    )
