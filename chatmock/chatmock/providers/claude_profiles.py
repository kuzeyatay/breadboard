"""Read the profile metadata shared with Claude Code's local launcher and settings."""

import json
import os
import re
import time
from datetime import datetime
from pathlib import Path
from uuid import uuid4

PROFILE_ID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
LIMIT_MESSAGE = re.compile(
    r"(?:you(?:['’]ve| have) (?:hit|reached) (?:your|the) (?:[\w -]+ )?limit\b|"
    r"(?:usage|session|weekly|rate)[ _-]limit(?:[ _-](?:error|reached|exceeded|hit))?\b|"
    r"too many requests\b|\b429\b.{0,24}(?:request|limit))", re.I,
)


def root():
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude").resolve()


def _read(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def candidates(directory, *, include_resting=False):
    store = directory / ".breadboard" / "accounts"
    preferred = _read(store / "preferred.json")
    ids = ["default", *sorted(p.stem for p in store.glob("*.json") if PROFILE_ID.fullmatch(p.stem))]
    rows = []
    for account in ids:
        info = _read(store / (account + ".json"), {"loggedIn": account == "default"})
        if info.get("loggedIn"):
            rows.append((account != preferred, info.get("connectedAt") or "", account, info.get("email")))
    seen = set()
    available = []
    for _, _, account, email in sorted(rows):
        identity = email.lower() if email else account
        if identity in seen:
            continue
        seen.add(identity)
        if include_resting or (_read(store / (account + ".reset"), 0) or 0) <= time.time() * 1000:
            available.append(account)
    return available


def config_dir(directory, account):
    return directory if account == "default" else directory / ".breadboard" / "accounts" / account


def mark_limited(directory, account, reset_at=None):
    now = time.time() * 1000
    until = reset_at if reset_at and reset_at > now else 0
    # A usage snapshot can identify the weekly reset even when the CLI's error
    # only says "usage limit reached". Use windows that are actually exhausted.
    try:
        cached = _read(config_dir(directory, account) / ".breadboard" / "usage-cache.json") or {}
        report = cached.get("snapshot") or {}
        captured = datetime.fromisoformat(report["captured_at"].replace("Z", "+00:00")).timestamp() * 1000
        for row in report.get("limits", []):
            window = row["limit"]
            if window["used_percent"] >= 100:
                reset = captured + window["resets_in_seconds"] * 1000
                if reset > now:
                    until = max(reset, until)
    except (KeyError, TypeError, ValueError, OSError):
        pass
    store = directory / ".breadboard" / "accounts"
    store.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = store / (str(uuid4()) + ".tmp")
    try:
        temporary.write_text(str(int(until or now + 300_000)), encoding="utf-8")
        temporary.replace(store / (account + ".reset"))
    finally:
        temporary.unlink(missing_ok=True)
