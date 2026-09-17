from __future__ import annotations

"""OpenAI's own usage report for a ChatGPT account, reserve pool included.

The rate-limit headers ChatMock captures on every reply (`limits.py`) say how
much of the plan's windows is spent, and nothing more. They are silent about
what OpenAI does once a window closes: a paid plan is not cut off, it is moved
onto a **reserve** — a separate weekly allowance metered against
`gpt-reserve` and served by a smaller model (`gpt-5.6-luna` at the time of
writing). The ChatGPT app shows a banner for this ("You're now using Luna, a
faster model for simpler tasks"); Breadboard could not, because the header
snapshot never mentions it.

`GET https://chatgpt.com/backend-api/wham/usage` is what the app reads. It
costs no quota, names the plan, both windows, every additional pool with the
model it serves, the banner, and the credit balance. This module fetches it for
one signed-in account and reduces it to the shape the dashboard already draws
(`primary` / `secondary` windows), adding a `reserve` block beside them.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

import requests

from .utils import load_chatgpt_tokens

USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"

#: The pool OpenAI moves a spent plan onto. Reserve rows are recognised by
#: this name; the model they serve comes from the payload, not from here.
RESERVE_LIMIT_NAME = "gpt-reserve"


class CodexUsageError(RuntimeError):
    """The report could not be read — no credentials, or upstream refused."""


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _window(value: Any) -> Optional[Dict[str, Any]]:
    """One `*_window` object as the dashboard's `UsageLimitWindow`."""
    if not isinstance(value, dict):
        return None
    used = _number(value.get("used_percent"))
    if used is None:
        return None
    window: Dict[str, Any] = {"used_percent": max(0.0, min(100.0, used))}
    seconds = _number(value.get("limit_window_seconds"))
    if seconds is not None and seconds > 0:
        window["window_minutes"] = int(seconds // 60)
    resets = _number(value.get("reset_after_seconds"))
    if resets is not None:
        window["resets_in_seconds"] = max(0, int(resets))
    return window


def _limit(value: Any) -> Dict[str, Any]:
    """A `rate_limit` object: both windows plus its allowed/reached flags."""
    record = value if isinstance(value, dict) else {}
    return {
        "allowed": record.get("allowed") is not False,
        "limit_reached": record.get("limit_reached") is True,
        "primary": _window(record.get("primary_window")),
        "secondary": _window(record.get("secondary_window")),
    }


def _reserve(raw: Dict[str, Any], plan_reached: bool) -> Optional[Dict[str, Any]]:
    """The reserve pool, if the account has one.

    `active` is the claim the user actually wants to see: the plan window is
    closed and requests are being served from the reserve. OpenAI says so with
    an upsell banner typed `luna_reserve`; when the banner is absent (the
    payload has been seen without it right after the window closes) the same
    conclusion follows from the plan being spent while the reserve still has
    room.
    """
    pools = raw.get("additional_rate_limits")
    if not isinstance(pools, list):
        return None
    for pool in pools:
        if not isinstance(pool, dict):
            continue
        name = str(pool.get("limit_name") or "").strip()
        if name.lower() != RESERVE_LIMIT_NAME:
            continue
        limit = _limit(pool.get("rate_limit"))
        model = pool.get("normal_model_slug")
        banner = raw.get("rate_limit_upsell")
        banner_type = (
            str(banner.get("banner_type") or "").strip().lower()
            if isinstance(banner, dict)
            else ""
        )
        available = limit["allowed"] and not limit["limit_reached"]
        active = available and (banner_type.endswith("_reserve") or plan_reached)
        return {
            "name": name,
            "model": model if isinstance(model, str) and model.strip() else None,
            "active": active,
            "allowed": limit["allowed"],
            "limit_reached": limit["limit_reached"],
            "primary": limit["primary"],
            "secondary": limit["secondary"],
        }
    return None


def _banner(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    banner = raw.get("rate_limit_upsell")
    if not isinstance(banner, dict):
        return None
    kind = banner.get("banner_type")
    if not isinstance(kind, str) or not kind.strip():
        return None
    return {
        "type": kind.strip(),
        "title": banner.get("title") if isinstance(banner.get("title"), str) else None,
        "description": (
            banner.get("description") if isinstance(banner.get("description"), str) else None
        ),
    }


def _credits(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    credits = raw.get("credits")
    if not isinstance(credits, dict):
        return None
    return {
        "has_credits": credits.get("has_credits") is True,
        "unlimited": credits.get("unlimited") is True,
        "balance": _number(credits.get("balance")),
    }


def normalize_codex_usage(raw: Any, captured_at: Optional[datetime] = None) -> Dict[str, Any]:
    """Reduce a `wham/usage` payload to what the dashboard draws."""
    if not isinstance(raw, dict):
        raise CodexUsageError("The usage report was not a JSON object.")
    when = captured_at or datetime.now(timezone.utc)
    plan_limit = _limit(raw.get("rate_limit"))
    email = raw.get("email")
    plan = raw.get("plan_type")
    return {
        "captured_at": when.astimezone(timezone.utc).isoformat(),
        "email": email if isinstance(email, str) else None,
        "plan": plan if isinstance(plan, str) else None,
        "allowed": plan_limit["allowed"],
        "limit_reached": plan_limit["limit_reached"],
        "primary": plan_limit["primary"],
        "secondary": plan_limit["secondary"],
        "reserve": _reserve(raw, plan_limit["limit_reached"]),
        "banner": _banner(raw),
        "credits": _credits(raw),
    }


def fetch_codex_usage(
    auth: Dict[str, Any],
    auth_path: str,
    *,
    timeout: float = 20.0,
) -> Dict[str, Any]:
    """Read and normalise the report for the account in `auth` (an auth.json bundle)."""
    access_token, account_id, _ = load_chatgpt_tokens(selected=(auth, auth_path))
    if not access_token:
        raise CodexUsageError("That account has no usable access token; sign in again.")
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "User-Agent": "chatmock",
    }
    if account_id:
        headers["ChatGPT-Account-Id"] = account_id
    try:
        response = requests.get(USAGE_URL, headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        raise CodexUsageError(f"Could not reach OpenAI's usage report: {exc}") from exc
    if response.status_code == 401:
        raise CodexUsageError("OpenAI rejected the account's token; sign in again.")
    if response.status_code >= 400:
        raise CodexUsageError(
            f"OpenAI's usage report answered HTTP {response.status_code}."
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise CodexUsageError("OpenAI's usage report was not JSON.") from exc
    return normalize_codex_usage(payload)
