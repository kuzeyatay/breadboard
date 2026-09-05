"""Live model discovery for configured providers.

The catalog used to be whatever ``ProviderSpec.suggested_models`` said at the
time of a ChatMock release plus the ids a person pinned by hand, so a model
that shipped last week — Claude Fable 5.1, say — was invisible until someone
edited a list. Every provider ChatMock talks to can be asked what it serves,
so this module asks, remembers the answer on disk, and refreshes it quietly
in the background.

Three sources feed ``discovered_models_for``:

* OpenAI-compatible providers answer ``GET /models``.
* Anthropic answers ``GET /v1/models``.
* The Claude Code bridge (``cliproxy/claude-*``) has no listing of its own —
  the official CLI takes any current Claude id — so its ids are derived from
  OpenRouter's public catalog, which needs no key and names every Claude
  release Anthropic publishes.

A gateway that resells hundreds of models (OpenRouter, Together) is narrowed
to the vendor namespaces already present in the person's list, newest first:
"upgrade what I use", not "show me everything". Everything here is
best-effort: a provider that cannot be reached contributes its last known
list, or nothing, and never an error.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Callable, Dict, Iterable, List, Sequence

import requests

from . import store
from .catalog import KIND_ANTHROPIC, KIND_CHATGPT_OAUTH, KIND_OPENAI_COMPATIBLE, ProviderSpec
from .store import ResolvedCredentials

DISCOVERY_FILENAME = "discovered_models.json"
REFRESH_INTERVAL_SECONDS = 15 * 60
# A list older than this is not shown any more: the provider has been
# unreachable for a week, and stale ids would only produce 404s.
MAX_AGE_SECONDS = 7 * 24 * 60 * 60
FETCH_TIMEOUT_SECONDS = 8
# Above this many models a provider is a marketplace, not a vendor; narrow it
# to the namespaces the person already uses.
LARGE_CATALOG = 60
PER_NAMESPACE_LIMIT = 20
SMALL_CATALOG_LIMIT = 60
CLAUDE_CODE_LIMIT = 12

PUBLIC_OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
_PUBLIC_OPENROUTER_KEY = "public:openrouter"

# Ids that are not chat models, whatever provider lists them.
_NON_CHAT_PATTERNS = re.compile(
    r"(embed|embedding|whisper|tts|speech|transcri|moderation|realtime|audio|"
    r"dall-e|image|imagen|veo|sora|rerank|guard|vision-only|:batch$|:free$)",
    re.IGNORECASE,
)
_CLAUDE_CODE_FAMILIES = ("opus", "sonnet", "haiku", "fable")

_lock = threading.Lock()
_refreshing: set[str] = set()
# Tests flip this off so a refresh runs inline instead of on a daemon thread
# that could outlive the temporary directory it writes to.
background_refresh = True


def discovery_enabled() -> bool:
    """Off switch for tests and offline deployments (``CHATMOCK_MODEL_DISCOVERY=0``)."""
    return (os.getenv("CHATMOCK_MODEL_DISCOVERY") or "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def discovery_path() -> str:
    override = (os.getenv("CHATMOCK_DISCOVERY_FILE") or "").strip()
    if override:
        return os.path.abspath(override)
    return os.path.join(os.path.dirname(store.settings_path()), DISCOVERY_FILENAME)


# ---------------------------------------------------------------------------
# Cache


def _read_cache() -> Dict[str, Dict[str, Any]]:
    try:
        with open(discovery_path(), "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError):
        return {}
    entries = raw.get("entries") if isinstance(raw, dict) else None
    return {k: v for k, v in entries.items() if isinstance(v, dict)} if isinstance(entries, dict) else {}


def _write_cache(entries: Dict[str, Dict[str, Any]]) -> None:
    path = discovery_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "entries": entries}, handle, indent=2)
        os.replace(tmp, path)
    except OSError:
        # A cache that cannot be written only costs a refetch next time.
        pass


def _entry(key: str) -> Dict[str, Any] | None:
    with _lock:
        return _read_cache().get(key)


def _store_entry(key: str, models: List[str], fingerprint: str) -> None:
    with _lock:
        entries = _read_cache()
        entries[key] = {
            "fetched_at": time.time(),
            "fingerprint": fingerprint,
            "models": list(models),
        }
        _write_cache(entries)


def clear_cache() -> None:
    with _lock:
        _write_cache({})


# ---------------------------------------------------------------------------
# Fetching


def _model_rows(payload: Any) -> List[Dict[str, Any]]:
    data = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(data, list):
        return []
    rows: List[Dict[str, Any]] = []
    for item in data:
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].strip():
            rows.append(item)
        elif isinstance(item, str) and item.strip():
            rows.append({"id": item.strip()})
    return rows


def _fetch_json(url: str, headers: Dict[str, str]) -> Any:
    response = requests.get(url, headers=headers, timeout=FETCH_TIMEOUT_SECONDS)
    if response.status_code >= 400:
        raise RuntimeError(f"{url} returned HTTP {response.status_code}")
    return response.json()


def fetch_provider_rows(spec: ProviderSpec, credentials: ResolvedCredentials) -> List[Dict[str, Any]]:
    """Raw model rows from one provider's listing endpoint."""
    base = (credentials.base_url or "").rstrip("/")
    if not base:
        return []
    if spec.kind == KIND_ANTHROPIC:
        from . import anthropic

        headers = anthropic.build_headers(credentials)
        headers.pop("Content-Type", None)
        return _model_rows(_fetch_json(f"{base}/v1/models?limit=100", headers))
    if spec.kind == KIND_OPENAI_COMPATIBLE:
        from . import openai_compatible

        headers = openai_compatible.build_headers(credentials)
        headers.pop("Content-Type", None)
        return _model_rows(_fetch_json(openai_compatible.models_url(credentials), headers))
    return []


def fetch_public_openrouter_rows() -> List[Dict[str, Any]]:
    return _model_rows(_fetch_json(PUBLIC_OPENROUTER_MODELS_URL, {}))


# Seams for tests: replace these to answer without a network.
_fetch_provider_rows: Callable[[ProviderSpec, ResolvedCredentials], List[Dict[str, Any]]] = fetch_provider_rows
_fetch_public_openrouter_rows: Callable[[], List[Dict[str, Any]]] = fetch_public_openrouter_rows


# ---------------------------------------------------------------------------
# Shaping


def _created(row: Dict[str, Any]) -> float:
    value = row.get("created")
    return float(value) if isinstance(value, (int, float)) else 0.0


def _is_chat_model(model_id: str) -> bool:
    if model_id.startswith("~") or model_id.startswith("openrouter/"):
        return False
    return not _NON_CHAT_PATTERNS.search(model_id)


def _namespace(model_id: str) -> str:
    return model_id.split("/", 1)[0] if "/" in model_id else ""


def shape_provider_models(
    rows: Sequence[Dict[str, Any]],
    configured: Iterable[str],
) -> List[str]:
    """Turn a provider's raw listing into the ids worth offering.

    ``configured`` is what the person already uses on this provider; on a
    marketplace-sized catalog it decides which vendor namespaces to keep.
    """
    chat_rows = [row for row in rows if _is_chat_model(str(row["id"]))]
    ordered = sorted(chat_rows, key=_created, reverse=True)
    if len(chat_rows) <= LARGE_CATALOG:
        return [str(row["id"]) for row in ordered[:SMALL_CATALOG_LIMIT]]

    namespaces = {_namespace(model) for model in configured if _namespace(model)}
    if not namespaces:
        return []
    kept: List[str] = []
    per_namespace: Dict[str, int] = {}
    for row in ordered:
        model_id = str(row["id"])
        namespace = _namespace(model_id)
        if namespace not in namespaces:
            continue
        if per_namespace.get(namespace, 0) >= PER_NAMESPACE_LIMIT:
            continue
        per_namespace[namespace] = per_namespace.get(namespace, 0) + 1
        kept.append(model_id)
    return kept


def claude_code_id_from_openrouter(model_id: str) -> str | None:
    """``anthropic/claude-fable-5.1`` -> ``claude-fable-5-1`` (the id the CLI takes)."""
    if not model_id.startswith("anthropic/claude-"):
        return None
    bare = model_id.split("/", 1)[1]
    if ":" in bare or not _is_chat_model(model_id):
        return None
    family = bare.split("-")
    if len(family) < 2 or family[1] not in _CLAUDE_CODE_FAMILIES:
        return None
    return bare.replace(".", "-")


def shape_claude_code_models(rows: Sequence[Dict[str, Any]]) -> List[str]:
    ordered = sorted(rows, key=_created, reverse=True)
    result: List[str] = []
    for row in ordered:
        mapped = claude_code_id_from_openrouter(str(row.get("id") or ""))
        if mapped and mapped not in result:
            result.append(mapped)
        if len(result) >= CLAUDE_CODE_LIMIT:
            break
    return result


# ---------------------------------------------------------------------------
# Refresh policy


def _fingerprint(spec: ProviderSpec, credentials: ResolvedCredentials, configured: Sequence[str]) -> str:
    key = credentials.api_key or ""
    return json.dumps(
        {
            "base": credentials.base_url or "",
            "key": f"{len(key)}:{key[-4:]}" if key else "",
            "configured": sorted(set(configured)),
        },
        sort_keys=True,
    )


def _refresh_in_background(key: str, work: Callable[[], None]) -> None:
    if not background_refresh:
        try:
            work()
        except Exception:
            pass
        return
    with _lock:
        if key in _refreshing:
            return
        _refreshing.add(key)

    def run() -> None:
        try:
            work()
        except Exception:
            pass
        finally:
            with _lock:
                _refreshing.discard(key)

    threading.Thread(target=run, name=f"model-discovery:{key}", daemon=True).start()


def _resolve(
    key: str,
    fingerprint: str,
    fetch: Callable[[], List[str]],
) -> List[str]:
    """Cached list for ``key``: fetched now if unknown, refreshed later if old."""
    entry = _entry(key)
    now = time.time()
    fresh = (
        entry is not None
        and entry.get("fingerprint") == fingerprint
        and isinstance(entry.get("models"), list)
        and now - float(entry.get("fetched_at") or 0) <= MAX_AGE_SECONDS
    )

    def refresh() -> None:
        _store_entry(key, fetch(), fingerprint)

    if not fresh:
        # First sight of this provider (or its credentials changed): the
        # answer is worth a bounded wait, because an empty menu is worse.
        try:
            models = fetch()
        except Exception:
            return []
        _store_entry(key, models, fingerprint)
        return models
    if now - float(entry.get("fetched_at") or 0) > REFRESH_INTERVAL_SECONDS:
        _refresh_in_background(key, refresh)
    return [str(m) for m in entry.get("models", []) if isinstance(m, str)]


def discovered_models_for(spec: ProviderSpec, configured: Sequence[str]) -> List[str]:
    """Ids the provider itself reports, beyond ``configured`` (suggested + pinned)."""
    if not discovery_enabled() or spec.kind == KIND_CHATGPT_OAUTH:
        return []
    credentials = store.resolve_credentials(spec)
    if not credentials.usable:
        return []
    if spec.id == "cliproxy":
        # The subscription proxy's own listing is synced by the dashboard,
        # which also knows about Claude Code. Only the Claude ids are derived
        # here, and only once Claude is signed in (a claude-* id was synced).
        if not any(m.lower().startswith("claude-") for m in configured):
            return []
        return _resolve(
            _PUBLIC_OPENROUTER_KEY,
            "claude-code",
            lambda: shape_claude_code_models(_fetch_public_openrouter_rows()),
        )
    return _resolve(
        f"provider:{spec.id}",
        _fingerprint(spec, credentials, configured),
        lambda: shape_provider_models(_fetch_provider_rows(spec, credentials), configured),
    )
