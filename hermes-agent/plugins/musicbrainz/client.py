"""HTTP layer for the MusicBrainz plugin.

Everything that talks to musicbrainz.org or coverartarchive.org goes
through :func:`mb_get` / :func:`caa_get` in this module. That is deliberate:
the MusicBrainz rate-limiting policy is enforced per source IP, not per
caller, so the throttle has to live below the tools rather than inside
them. Six tools calling in parallel still share one gate.

Policy notes that shaped this file (see
https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting):

- Anonymous clients get roughly 1 request/second averaged per IP. Going
  over gets *every* request from that IP declined with 503 until the rate
  drops, so the throttle is conservative (1.1s) rather than exactly 1.0s.
- A meaningful User-Agent is mandatory. Blank/library-default agents
  ("python-urllib", "Java", ...) are explicitly throttled harder. We send
  "HermesMusicBrainz/<version> ( <contact> )" and refuse to make a request
  at all if no contact address is configured, because a request without one
  is a request that gets blocked.
- The API serves XML unless you ask otherwise, so fmt=json is forced here
  instead of being left to each call site.

There is no API key. MusicBrainz is open data; authentication only exists
for write operations and user collections, neither of which this plugin
does. If a future edit adds an auth field, that is a bug.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, Optional

import httpx

PLUGIN_VERSION = "0.1"

MB_BASE = "https://musicbrainz.org/ws/2"
CAA_BASE = "https://coverartarchive.org"

# 1 req/sec is the documented ceiling; the extra 100ms absorbs clock jitter
# and network reordering so we land under the limit rather than on it.
MIN_INTERVAL_SECONDS = 1.1

# 503 means "you are over the limit" far more often than "we are down", so
# it is retried rather than surfaced. 429 is included defensively.
RETRY_STATUSES = frozenset({429, 503})
MAX_RETRIES = 3
BACKOFF_BASE_SECONDS = 1.5

REQUEST_TIMEOUT_SECONDS = 30.0


class MusicBrainzError(Exception):
    """Base class for MusicBrainz failures worth reporting to the model."""


class MusicBrainzConfigError(MusicBrainzError):
    """No contact address configured, so no request may legally be sent."""


class MusicBrainzNotFoundError(MusicBrainzError):
    """404 - the MBID does not exist (or is not of the expected entity type)."""


class MusicBrainzRateLimitError(MusicBrainzError):
    """Still rate limited after exhausting the retry budget."""


class MusicBrainzAPIError(MusicBrainzError):
    """Any other non-2xx response."""

    def __init__(self, message: str, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Contact address / User-Agent
# ---------------------------------------------------------------------------


def get_contact_email() -> str:
    """Return the configured contact address for the User-Agent header.

    Resolution order: ``HERMES_MUSICBRAINZ_CONTACT`` env var, then
    ``plugins.entries.musicbrainz.contact_email`` in config.yaml. Raises
    rather than substituting a placeholder: MusicBrainz treats an
    unidentifiable client as abuse, and a fake address would get the whole
    host blocked instead of failing here where it is debuggable.
    """
    import os

    env_value = (os.environ.get("HERMES_MUSICBRAINZ_CONTACT") or "").strip()
    if env_value:
        return env_value

    try:
        from hermes_cli.config import load_config_readonly

        cfg = load_config_readonly() or {}
    except Exception:
        cfg = {}

    entry = ((cfg.get("plugins") or {}).get("entries") or {}).get("musicbrainz") or {}
    configured = str(entry.get("contact_email") or "").strip()
    if configured:
        return configured

    raise MusicBrainzConfigError(
        "No MusicBrainz contact address configured. MusicBrainz requires every "
        "request to identify the application and a way to reach its maintainer. "
        "Set plugins.entries.musicbrainz.contact_email in ~/.hermes/config.yaml "
        "(or the HERMES_MUSICBRAINZ_CONTACT environment variable) to an email "
        "address or URL. There is no API key to configure - this is the only "
        "credential-shaped setting the plugin has."
    )


def build_user_agent() -> str:
    """Build the mandatory User-Agent, e.g. ``HermesMusicBrainz/0.1 ( me@example.com )``."""
    return f"HermesMusicBrainz/{PLUGIN_VERSION} ( {get_contact_email()} )"


# ---------------------------------------------------------------------------
# Shared throttle
# ---------------------------------------------------------------------------

_throttle_lock = threading.Lock()
_last_request_at = 0.0

# Diagnostics only - lets the verification step prove the gate is real.
_request_log: list = []
_request_log_lock = threading.Lock()


def _throttle() -> None:
    """Block until at least MIN_INTERVAL_SECONDS has passed since the last request.

    The lock is held *across* the sleep on purpose. Releasing it before
    sleeping would let every waiting thread compute the same "wait until"
    instant and then fire simultaneously, which is exactly the burst the
    policy forbids. Holding it serialises callers into a queue, so N
    concurrent tool calls go out N intervals apart rather than all at once.
    """
    global _last_request_at
    with _throttle_lock:
        now = time.monotonic()
        elapsed = now - _last_request_at
        if _last_request_at and elapsed < MIN_INTERVAL_SECONDS:
            time.sleep(MIN_INTERVAL_SECONDS - elapsed)
        _last_request_at = time.monotonic()


def _record_request(url: str) -> None:
    with _request_log_lock:
        _request_log.append((time.monotonic(), url))
        if len(_request_log) > 200:
            del _request_log[:-200]


def get_request_log() -> list:
    """Return (monotonic_timestamp, url) for recent requests. Diagnostics only."""
    with _request_log_lock:
        return list(_request_log)


def reset_request_log() -> None:
    with _request_log_lock:
        _request_log.clear()


# ---------------------------------------------------------------------------
# Request execution
# ---------------------------------------------------------------------------


def _request_json(url: str, params: Optional[Dict[str, Any]], *, entity_hint: str) -> Any:
    """GET a JSON document, obeying the throttle and retrying 503s."""
    headers = {
        "User-Agent": build_user_agent(),
        "Accept": "application/json",
    }

    last_status: Optional[int] = None
    for attempt in range(MAX_RETRIES + 1):
        _throttle()
        _record_request(url)
        try:
            response = httpx.get(
                url,
                params=params,
                headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS,
                follow_redirects=True,
            )
        except httpx.HTTPError as exc:
            if attempt < MAX_RETRIES:
                time.sleep(BACKOFF_BASE_SECONDS * (2**attempt))
                continue
            raise MusicBrainzAPIError(f"Network error contacting MusicBrainz: {exc}") from exc

        status = response.status_code
        last_status = status

        # MusicBrainz answers some unusable identifiers (e.g. the nil UUID)
        # with 400 "Invalid mbid" rather than 404. Both mean the same thing to
        # a caller: that identifier resolves to nothing.
        if status == 400 and "invalid mbid" in (response.text or "").lower():
            raise MusicBrainzNotFoundError(
                f"That MBID is not a valid MusicBrainz identifier, so no "
                f"{entity_hint} could be looked up. Use a search tool to obtain "
                "a real MBID."
            )

        if status == 404:
            raise MusicBrainzNotFoundError(
                f"No {entity_hint} found with that MBID. Check the identifier - "
                "MBIDs are entity-specific, so an artist MBID will 404 on a "
                "release lookup even though both are valid UUIDs."
            )

        if status in RETRY_STATUSES:
            if attempt < MAX_RETRIES:
                # Retry-After is advisory here but honour it when present.
                retry_after = response.headers.get("Retry-After")
                try:
                    delay = float(retry_after) if retry_after else BACKOFF_BASE_SECONDS * (2**attempt)
                except (TypeError, ValueError):
                    delay = BACKOFF_BASE_SECONDS * (2**attempt)
                time.sleep(min(delay, 30.0))
                continue
            raise MusicBrainzRateLimitError(
                f"MusicBrainz is still returning {status} after {MAX_RETRIES} retries. "
                "The per-IP rate limit is roughly 1 request/second and applies to "
                "every client on this host, so something else may also be querying it. "
                "Wait a few seconds and try again."
            )

        if status >= 400:
            body = (response.text or "")[:300]
            raise MusicBrainzAPIError(
                f"MusicBrainz returned HTTP {status}: {body}", status_code=status
            )

        try:
            return response.json()
        except Exception as exc:
            raise MusicBrainzAPIError(
                f"MusicBrainz returned a non-JSON body (HTTP {status}): {exc}",
                status_code=status,
            ) from exc

    raise MusicBrainzAPIError("Request failed", status_code=last_status)


def mb_get(path: str, params: Optional[Dict[str, Any]] = None, *, entity_hint: str = "entity") -> Any:
    """GET from the MusicBrainz web service. ``fmt=json`` is forced.

    The API defaults to XML, so leaving fmt to the caller is a latent bug.
    """
    merged = dict(params or {})
    merged["fmt"] = "json"
    return _request_json(f"{MB_BASE}/{path.lstrip('/')}", merged, entity_hint=entity_hint)


def caa_get(path: str) -> Any:
    """GET from the Cover Art Archive.

    Different host, but routed through the same throttle: CAA redirects to
    archive.org and is fronted by the same courtesy expectations, and one
    shared gate is simpler to reason about than two.
    """
    return _request_json(f"{CAA_BASE}/{path.lstrip('/')}", None, entity_hint="release")


# ---------------------------------------------------------------------------
# Lucene query helpers
# ---------------------------------------------------------------------------

_LUCENE_SPECIALS = set('+-&|!(){}[]^"~*?:\\/')


def escape_lucene(value: str) -> str:
    """Escape Lucene syntax so a title like ``Where Are We Now?`` is literal."""
    out = []
    for ch in str(value):
        if ch in _LUCENE_SPECIALS:
            out.append("\\")
        out.append(ch)
    return "".join(out)


def coerce_limit(raw: Any, *, default: int = 10, minimum: int = 1, maximum: int = 100) -> int:
    """Clamp a caller-supplied limit into the range the API accepts."""
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def coerce_bool(raw: Any, default: bool = False) -> bool:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        cleaned = raw.strip().lower()
        if cleaned in {"1", "true", "yes", "on"}:
            return True
        if cleaned in {"0", "false", "no", "off"}:
            return False
    return default


_UUID_CHARS = set("0123456789abcdef-")


def validate_mbid(raw: Any, *, field: str = "mbid") -> str:
    """Validate an MBID shape locally so a typo costs 0 requests, not 1."""
    value = str(raw or "").strip().lower()
    if len(value) != 36 or set(value) - _UUID_CHARS or value.count("-") != 4:
        raise MusicBrainzError(
            f"{field} must be a MusicBrainz ID (a 36-character UUID such as "
            f"'a74b1b7f-71a5-4011-9441-d0b5e4122711'), got {raw!r}. Use a search "
            "tool first to obtain the MBID."
        )
    return value
