from __future__ import annotations

"""Persistence for provider credentials and the global default model.

State lives in ``<CHATGPT_LOCAL_HOME>/providers.json`` next to the existing
``auth.json``, so a single home directory still describes everything ChatMock
needs to reach a model. The file is re-read whenever it changes on disk: the
dashboard writes it through ChatMock's own HTTP API, and a running proxy must
pick up a new key or a new default model without a restart (the same contract
the ChatGPT OAuth flow already has).

Secrets never leave this module in full. ``public_state`` returns a redacted
view; only the dispatch clients call ``resolve_credentials``.
"""

import json
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

from ..utils import eprint, get_home_dir
from .catalog import CHATGPT_PROVIDER_ID, ProviderSpec, iter_provider_specs, provider_spec

SETTINGS_FILENAME = "providers.json"
SETTINGS_VERSION = 1

# Sentinel model id meaning "whatever the user picked as the global default".
# Subsystems (Hermes, OpenCode, UI-TARS, deep-research) send this so the choice
# made in the dashboard applies without restarting every process.
DEFAULT_MODEL_SENTINEL = "default"
_SENTINELS = frozenset({DEFAULT_MODEL_SENTINEL, "auto", ""})


@dataclass
class ProviderRecord:
    """Stored configuration for one provider."""

    api_key: str | None = None
    base_url: str | None = None
    enabled: bool = True
    # Model ids the user pinned for this provider, on top of the catalog's
    # suggestions. Free-form so new upstream models need no ChatMock release.
    models: List[str] = field(default_factory=list)
    updated_at: str | None = None

    def to_json(self) -> Dict[str, Any]:
        return {
            "api_key": self.api_key,
            "base_url": self.base_url,
            "enabled": self.enabled,
            "models": list(self.models),
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_json(cls, value: Any) -> "ProviderRecord":
        if not isinstance(value, dict):
            return cls()
        raw_models = value.get("models")
        models = (
            [m.strip() for m in raw_models if isinstance(m, str) and m.strip()]
            if isinstance(raw_models, list)
            else []
        )
        return cls(
            api_key=_clean_str(value.get("api_key")),
            base_url=_clean_str(value.get("base_url")),
            enabled=bool(value.get("enabled", True)),
            models=models,
            updated_at=_clean_str(value.get("updated_at")),
        )


@dataclass
class ProviderSettings:
    default_model: str | None = None
    providers: Dict[str, ProviderRecord] = field(default_factory=dict)

    def to_json(self) -> Dict[str, Any]:
        return {
            "version": SETTINGS_VERSION,
            "default_model": self.default_model,
            "providers": {pid: record.to_json() for pid, record in self.providers.items()},
        }


@dataclass(frozen=True)
class ResolvedCredentials:
    """What a dispatch client needs to make a call, after env fallbacks."""

    provider_id: str
    api_key: str | None
    base_url: str | None
    # False when a required key is missing or the provider was switched off.
    usable: bool
    reason: str | None = None


def _clean_str(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def settings_path() -> str:
    override = _clean_str(os.getenv("CHATMOCK_PROVIDERS_FILE"))
    if override:
        return os.path.abspath(override)
    return os.path.abspath(os.path.join(get_home_dir(), SETTINGS_FILENAME))


_lock = threading.Lock()
_cache: Tuple[str, float, ProviderSettings] | None = None


def _parse_settings(raw: Any) -> ProviderSettings:
    if not isinstance(raw, dict):
        return ProviderSettings()
    providers_raw = raw.get("providers")
    providers: Dict[str, ProviderRecord] = {}
    if isinstance(providers_raw, dict):
        for pid, value in providers_raw.items():
            if not isinstance(pid, str) or not provider_spec(pid):
                continue
            providers[pid.strip().lower()] = ProviderRecord.from_json(value)
    return ProviderSettings(
        default_model=_clean_str(raw.get("default_model")),
        providers=providers,
    )


def read_settings() -> ProviderSettings:
    """Read settings, reusing the parse only while the file is unchanged."""
    global _cache
    path = settings_path()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        with _lock:
            _cache = None
        return ProviderSettings()

    with _lock:
        cached = _cache
        if cached is not None and cached[0] == path and cached[1] == mtime:
            return cached[2]

    try:
        with open(path, "r", encoding="utf-8") as fp:
            parsed = _parse_settings(json.load(fp))
    except (OSError, ValueError, TypeError):
        return ProviderSettings()

    with _lock:
        _cache = (path, mtime, parsed)
    return parsed


def write_settings(settings: ProviderSettings) -> bool:
    global _cache
    path = settings_path()
    directory = os.path.dirname(path) or "."
    try:
        os.makedirs(directory, exist_ok=True)
    except OSError as exc:
        eprint(f"ERROR: unable to create provider settings directory {directory}: {exc}")
        return False
    try:
        with open(path, "w", encoding="utf-8") as fp:
            # Credentials live here; keep the file owner-only where supported.
            if hasattr(os, "fchmod"):
                os.fchmod(fp.fileno(), 0o600)
            json.dump(settings.to_json(), fp, indent=2)
    except OSError as exc:
        eprint(f"ERROR: unable to write provider settings: {exc}")
        return False
    with _lock:
        _cache = None
    return True


def _env_value(names: Tuple[str, ...]) -> str | None:
    for name in names:
        value = _clean_str(os.getenv(name))
        if value:
            return value
    return None


_TRUE = {"1", "true", "yes", "on"}


def env_provider_keys_allowed() -> bool:
    """Whether a pay-per-token provider may be configured from the environment.

    Off by default. Breadboard runs on subscriptions, and a stray
    ``OPENAI_API_KEY`` — very often ChatMock's own ``local`` placeholder rather
    than a real credential — would otherwise mark that provider configured and
    fill the model picker with ids that answer 401.

    Headless and CI deployments that genuinely supply keys this way set
    ``CHATMOCK_ALLOW_ENV_PROVIDER_KEYS=1``.
    """
    return (os.getenv("CHATMOCK_ALLOW_ENV_PROVIDER_KEYS") or "").strip().lower() in _TRUE


def _usable_env_key(spec: ProviderSpec) -> str | None:
    """Env fallback for one provider, honouring the opt-in above.

    Providers that need no API key (the subscription proxy, Ollama, a custom
    endpoint) are unaffected: their env values are wiring, not credentials.
    """
    if spec.requires_api_key and not env_provider_keys_allowed():
        return None
    return _env_value(spec.api_key_env)


def provider_record(provider_id: str) -> ProviderRecord:
    return read_settings().providers.get(provider_id.strip().lower(), ProviderRecord())


def resolve_credentials(spec: ProviderSpec) -> ResolvedCredentials:
    """Merge stored config with environment fallbacks for one provider."""
    record = provider_record(spec.id)
    api_key = record.api_key or _usable_env_key(spec)
    base_url = record.base_url or _env_value(spec.base_url_env) or spec.default_base_url

    if not record.enabled:
        return ResolvedCredentials(spec.id, api_key, base_url, False, "provider is turned off")
    if spec.requires_api_key and not api_key:
        return ResolvedCredentials(spec.id, api_key, base_url, False, "no API key is configured")
    if not base_url:
        return ResolvedCredentials(spec.id, api_key, base_url, False, "no base URL is configured")
    return ResolvedCredentials(spec.id, api_key, base_url.rstrip("/"), True, None)


def is_configured(spec: ProviderSpec) -> bool:
    """True when the provider could serve a request right now.

    ChatGPT is special: it authenticates through the OAuth flow rather than this
    store, so its readiness is reported by the account surface, not here.
    """
    if spec.kind == "chatgpt_oauth":
        record = provider_record(spec.id)
        return record.enabled
    return resolve_credentials(spec).usable


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "…" + value[-2:]
    return f"{value[:4]}…{value[-4:]}"


def public_state() -> List[Dict[str, Any]]:
    """Redacted provider list for the management API and the settings UI."""
    settings = read_settings()
    out: List[Dict[str, Any]] = []
    for spec in iter_provider_specs():
        record = settings.providers.get(spec.id, ProviderRecord())
        resolved = resolve_credentials(spec) if spec.kind != "chatgpt_oauth" else None
        stored_key = record.api_key
        env_key = _usable_env_key(spec)
        out.append(
            {
                "id": spec.id,
                "label": spec.label,
                "kind": spec.kind,
                "description": spec.description,
                "docsUrl": spec.docs_url,
                "requiresApiKey": spec.requires_api_key,
                "baseUrlEditable": spec.base_url_editable,
                "defaultBaseUrl": spec.default_base_url,
                "baseUrl": record.base_url or _env_value(spec.base_url_env) or spec.default_base_url,
                "enabled": record.enabled,
                "configured": is_configured(spec),
                "hasStoredKey": bool(stored_key),
                # Surfaced so the UI can explain a provider that works without a
                # key having been entered in the app.
                "keyFromEnvironment": bool(env_key and not stored_key),
                "apiKeyHint": mask_secret(stored_key or env_key),
                "apiKeyEnv": list(spec.api_key_env),
                "models": sorted(set(list(spec.suggested_models) + list(record.models))),
                "suggestedModels": list(spec.suggested_models),
                "customModels": list(record.models),
                "unavailableReason": resolved.reason if resolved and not resolved.usable else None,
                "updatedAt": record.updated_at,
            }
        )
    return out


def upsert_provider(
    provider_id: str,
    *,
    api_key: str | None = None,
    clear_api_key: bool = False,
    base_url: str | None = None,
    clear_base_url: bool = False,
    enabled: bool | None = None,
    models: List[str] | None = None,
) -> ProviderRecord | None:
    """Create or update one provider record. Returns None for unknown ids."""
    spec = provider_spec(provider_id)
    if spec is None:
        return None

    settings = read_settings()
    record = settings.providers.get(spec.id, ProviderRecord())

    if clear_api_key:
        record.api_key = None
    elif api_key is not None:
        record.api_key = _clean_str(api_key)

    if clear_base_url:
        record.base_url = None
    elif base_url is not None:
        record.base_url = _clean_str(base_url)

    if enabled is not None:
        record.enabled = bool(enabled)

    if models is not None:
        record.models = [m.strip() for m in models if isinstance(m, str) and m.strip()]

    record.updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    settings.providers[spec.id] = record
    if not write_settings(settings):
        return None
    return record


def delete_provider(provider_id: str) -> bool:
    """Forget a provider's stored credentials. Environment fallbacks survive."""
    spec = provider_spec(provider_id)
    if spec is None:
        return False
    settings = read_settings()
    if spec.id not in settings.providers:
        return True
    del settings.providers[spec.id]
    return write_settings(settings)


def get_default_model(fallback: str) -> str:
    """The model that backs every subsystem that asks for `default`."""
    configured = _clean_str(os.getenv("CHATMOCK_DEFAULT_MODEL"))
    if configured and configured.lower() not in _SENTINELS:
        return configured
    stored = read_settings().default_model
    if stored and stored.lower() not in _SENTINELS:
        return stored
    return fallback


def set_default_model(model: str | None) -> bool:
    settings = read_settings()
    cleaned = _clean_str(model)
    settings.default_model = None if cleaned is None or cleaned.lower() in _SENTINELS else cleaned
    return write_settings(settings)


def is_default_sentinel(model: Any) -> bool:
    return isinstance(model, str) and model.strip().lower() in _SENTINELS


def chatgpt_enabled() -> bool:
    return provider_record(CHATGPT_PROVIDER_ID).enabled
