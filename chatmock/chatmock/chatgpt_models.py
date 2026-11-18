"""Account-scoped discovery of the signed-in Codex/ChatGPT model catalog.

Only catalog reads refresh over the network. Request routing reads the cached
metadata, so a model choice never adds an upstream discovery call to a turn.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Any
from functools import lru_cache

import requests

from .accounts import ChatGptAccount, select_account
from .utils import get_home_dir, load_chatgpt_tokens, _derive_account_id

MODELS_URL = "https://chatgpt.com/backend-api/codex/models"
REFRESH_SECONDS = 15 * 60
MAX_AGE_SECONDS = 7 * 24 * 60 * 60
RETRY_SECONDS = 60
FETCH_TIMEOUT_SECONDS = 8
_MODEL_ID = re.compile(r"[a-z0-9][a-z0-9._-]{0,127}")
_lock = threading.RLock()
_refreshing: set[tuple[str, str]] = set()
_retry_after: dict[tuple[str, str], float] = {}
_memory: dict[tuple[str, str], dict[str, Any]] = {}


@lru_cache(maxsize=4)
def _installed_client_version(executable: str, modified: int) -> str | None:
    try:
        result = subprocess.run(
            [executable, "--version"], capture_output=True, text=True, timeout=3,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        match = re.search(r"\b(\d+\.\d+\.\d+)\b", result.stdout) if result.returncode == 0 else None
        return match.group(1) if match else None
    except (OSError, subprocess.SubprocessError):
        return None


def client_version() -> str:
    override = (os.getenv("CHATMOCK_CODEX_CLIENT_VERSION") or "").strip()
    if re.fullmatch(r"\d+\.\d+\.\d+", override):
        return override
    executable = shutil.which("codex")
    if executable:
        try:
            version = _installed_client_version(executable, os.stat(executable).st_mtime_ns)
            if version and version != "0.0.0":
                return version
        except OSError:
            pass
    # Last verified protocol version for installations without a Codex CLI.
    # 0.0.0 is a development client and receives a deliberately reduced list.
    return "0.169.0"


def cache_path() -> str:
    return os.path.abspath(os.getenv("CHATMOCK_CHATGPT_MODELS_FILE") or
                           os.path.join(get_home_dir(), "chatgpt_models.json"))


def _account_key(account: ChatGptAccount) -> str:
    # Separate accounts and plans without writing identities or credentials.
    identity = json.dumps([account.key, account.path, account.plan])
    return hashlib.sha256(identity.encode()).hexdigest()


def _read_cache(path: str) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        return data.get("accounts", {}) if isinstance(data, dict) and isinstance(data.get("accounts"), dict) else {}
    except (OSError, ValueError):
        return {}


def _write_entry(path: str, key: str, models: list[dict[str, Any]]) -> None:
    with _lock:
        entries = _read_cache(path)
        entries[key] = {"fetched_at": time.time(), "models": models}
        folder = os.path.dirname(path)
        os.makedirs(folder, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=folder, delete=False) as handle:
                temporary = handle.name
                json.dump({"version": 1, "accounts": entries}, handle)
            os.replace(temporary, path)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)


def shape_models(payload: Any) -> list[dict[str, Any]]:
    rows = payload.get("models") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ValueError("ChatGPT returned an invalid model catalog")
    models: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("visibility") != "list":
            continue
        slug = row.get("slug")
        if not isinstance(slug, str) or not _MODEL_ID.fullmatch(slug) or slug in {"none", "chat", "default", "auto"}:
            continue
        levels = row.get("supported_reasoning_levels")
        if not isinstance(levels, list):
            continue
        efforts = [level.get("effort") if isinstance(level, dict) else level for level in levels]
        # This is the application's supported ladder. Unknown future levels do
        # not justify inventing a reasoning setting in the picker.
        known = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
        efforts = [effort for effort in known if effort in efforts]
        tiers = row.get("service_tiers")
        priority = isinstance(tiers, list) and any(isinstance(tier, dict) and tier.get("id") == "priority" for tier in tiers)
        speed_tiers = row.get("additional_speed_tiers")
        models[slug] = {
            "id": slug,
            "name": row.get("display_name") if isinstance(row.get("display_name"), str) else slug,
            "reasoning_efforts": efforts,
            "priority": priority or (isinstance(speed_tiers, list) and "fast" in speed_tiers),
        }
    return list(models.values())


def fetch_models(account: ChatGptAccount) -> list[dict[str, Any]]:
    for force_refresh in (False, True):
        token, account_id, id_token = load_chatgpt_tokens(
            selected=(account.auth, account.path), force_refresh=force_refresh,
            refresh_timeout=FETCH_TIMEOUT_SECONDS,
        )
        account_id = account_id or _derive_account_id(id_token)
        if not token or not account_id:
            raise ValueError("No signed-in ChatGPT account")
        response = requests.get(
            MODELS_URL,
            params={"client_version": client_version()},
            headers={"Authorization": f"Bearer {token}", "ChatGPT-Account-Id": account_id,
                     "Accept": "application/json", "User-Agent": "chatmock"},
            timeout=FETCH_TIMEOUT_SECONDS,
        )
        try:
            if response.status_code == 401 and not force_refresh:
                continue
            response.raise_for_status()
            return shape_models(response.json())
        finally:
            response.close()
    return []


def discovered_models(*, refresh: bool = False) -> list[dict[str, Any]]:
    if (os.getenv("CHATMOCK_MODEL_DISCOVERY") or "1").strip().lower() in {"0", "false", "no", "off"}:
        return []
    account = select_account()
    if account is None:
        return []
    path, key = cache_path(), _account_key(account)
    request_key = (path, key)
    with _lock:
        entry = _memory.get(request_key) or _read_cache(path).get(key)
    entry = entry if isinstance(entry, dict) else {}
    try:
        age = time.time() - float(entry.get("fetched_at", 0))
    except (ValueError, TypeError):
        age = float("inf")
    cached = entry.get("models")
    models = [
        row for row in cached
        if isinstance(row, dict) and isinstance(row.get("id"), str)
        and isinstance(row.get("reasoning_efforts"), list)
    ] if isinstance(cached, list) and age <= MAX_AGE_SECONDS else []
    if not refresh or age < REFRESH_SECONDS:
        return models
    with _lock:
        if request_key in _refreshing or time.time() < _retry_after.get(request_key, 0):
            return models
        _refreshing.add(request_key)

    def update() -> list[dict[str, Any]]:
        try:
            fresh = fetch_models(account)
            try:
                _write_entry(path, key, fresh)
            except OSError:
                # Read-only state directories still get discovery this session.
                with _lock:
                    _memory[request_key] = {"fetched_at": time.time(), "models": fresh}
            else:
                with _lock:
                    _memory.pop(request_key, None)
            return fresh
        except (requests.RequestException, OSError, ValueError):
            with _lock:
                _retry_after[request_key] = time.time() + RETRY_SECONDS
            return models
        finally:
            with _lock:
                _refreshing.discard(request_key)

    if not entry:
        return update()
    threading.Thread(target=update, name="chatgpt-model-discovery", daemon=True).start()
    return models
