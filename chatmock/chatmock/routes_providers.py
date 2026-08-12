from __future__ import annotations

"""Management API for provider credentials and the global default model.

These endpoints sit alongside the OpenAI-compatible surface so any client that
already knows ChatMock's base URL can configure it — the Breadboard dashboard
proxies them behind its own session auth. Like the rest of ChatMock (including
the ChatGPT OAuth login flow) they assume a loopback binding; nothing here
returns a stored secret, so a read is safe even when the port is exposed.
"""

from typing import Any, Dict, List

from flask import Blueprint, Response, current_app, jsonify, make_response, request

from .http import build_cors_headers
from .model_registry import list_public_models
from .providers import dispatch
from .providers.catalog import KIND_CHATGPT_OAUTH, provider_spec
from .accounts import account_state
from .providers.registry import active_failover
from .providers.registry import default_model as resolved_default_model
from .providers.registry import preferred_model
from .providers.registry import external_model_ids
from .providers.registry import provider_health_state
from .providers import store

providers_bp = Blueprint("providers", __name__)


def _json(payload: Dict[str, Any], status: int = 200) -> Response:
    resp = make_response(jsonify(payload), status)
    for key, value in build_cors_headers().items():
        resp.headers.setdefault(key, value)
    return resp


def _chatgpt_model_ids() -> List[str]:
    expose_variants = bool(current_app.config.get("EXPOSE_REASONING_MODELS"))
    return list_public_models(expose_reasoning_models=expose_variants)


def _state_payload() -> Dict[str, Any]:
    chatgpt_models = _chatgpt_model_ids()
    return {
        "providers": store.public_state(),
        "defaultModel": resolved_default_model(),
        "preferredModel": preferred_model(),
        "storedDefaultModel": store.read_settings().default_model,
        "chatgptModels": chatgpt_models,
        "externalModels": external_model_ids(),
        "settingsPath": store.settings_path(),
        # Present only while the chosen model is unavailable, so a client can
        # say which model is standing in and for how long.
        "failover": active_failover(),
        # Providers currently being stepped over because they keep failing.
        # Empty in the normal case, which is what makes it worth showing.
        "unhealthyProviders": provider_health_state(),
        "accounts": account_state(),
    }


@providers_bp.get("/v1/providers")
def list_providers() -> Response:
    return _json(_state_payload())


@providers_bp.route("/v1/providers/<provider_id>", methods=["PUT", "PATCH"])
def update_provider(provider_id: str) -> Response:
    spec = provider_spec(provider_id)
    if spec is None:
        return _json({"error": {"message": "Unknown provider"}}, 404)

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _json({"error": {"message": "Request body must be a JSON object"}}, 400)

    api_key = payload.get("apiKey")
    base_url = payload.get("baseUrl")
    enabled = payload.get("enabled")
    models = payload.get("models")

    if enabled is not None and not isinstance(enabled, bool):
        return _json({"error": {"message": "enabled must be a boolean"}}, 400)
    if models is not None and not isinstance(models, list):
        return _json({"error": {"message": "models must be an array of strings"}}, 400)
    if api_key is not None and not isinstance(api_key, str):
        return _json({"error": {"message": "apiKey must be a string"}}, 400)
    if base_url is not None and not isinstance(base_url, str):
        return _json({"error": {"message": "baseUrl must be a string"}}, 400)

    record = store.upsert_provider(
        spec.id,
        api_key=api_key,
        # An empty string is an explicit "forget the stored key" from the UI,
        # distinct from omitting the field (leave it untouched).
        clear_api_key=isinstance(api_key, str) and not api_key.strip(),
        base_url=base_url,
        clear_base_url=isinstance(base_url, str) and not base_url.strip(),
        enabled=enabled,
        models=models,
    )
    if record is None:
        return _json({"error": {"message": "Provider settings could not be saved"}}, 500)
    return _json(_state_payload())


@providers_bp.delete("/v1/providers/<provider_id>")
def forget_provider(provider_id: str) -> Response:
    if provider_spec(provider_id) is None:
        return _json({"error": {"message": "Unknown provider"}}, 404)
    if not store.delete_provider(provider_id):
        return _json({"error": {"message": "Provider settings could not be cleared"}}, 500)
    return _json(_state_payload())


@providers_bp.post("/v1/providers/<provider_id>/verify")
def verify_provider(provider_id: str) -> Response:
    spec = provider_spec(provider_id)
    if spec is None:
        return _json({"error": {"message": "Unknown provider"}}, 404)
    if spec.kind == KIND_CHATGPT_OAUTH:
        return _json(
            {"ok": False, "error": "ChatGPT credentials are managed by the sign-in flow"},
            400,
        )
    result = dispatch.verify_provider(spec.id)
    return _json(result, 200 if result.get("ok") else 502)


@providers_bp.get("/v1/settings/default-model")
def get_default_model() -> Response:
    settings = store.read_settings()
    return _json(
        {
            "defaultModel": resolved_default_model(),
            "storedDefaultModel": settings.default_model,
        }
    )


@providers_bp.route("/v1/settings/default-model", methods=["PUT", "POST"])
def put_default_model() -> Response:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _json({"error": {"message": "Request body must be a JSON object"}}, 400)

    model = payload.get("model")
    if model is not None and not isinstance(model, str):
        return _json({"error": {"message": "model must be a string"}}, 400)

    if isinstance(model, str) and model.strip():
        # Refuse an id no configured provider can serve, so the setting cannot
        # silently break every subsystem that asks for `default`.
        from .providers.registry import resolve_model

        resolved = resolve_model(model)
        if not resolved.is_chatgpt:
            try:
                dispatch.credentials_for(resolved.provider)
            except Exception as exc:
                return _json({"error": {"message": str(exc)}}, 400)

    if not store.set_default_model(model):
        return _json({"error": {"message": "The default model could not be saved"}}, 500)
    return _json(_state_payload())


@providers_bp.get("/v1/settings/model-health")
def model_health() -> Response:
    """Which models and accounts are currently unavailable, and what is serving.

    Polled by the dashboard so a spent plan window is announced once, in the
    place the model is chosen, instead of surfacing as an unexplained error in
    whichever subsystem happened to ask first.
    """
    from .failover import active_cooldowns

    return _json(
        {
            "preferredModel": preferred_model(),
            "servingModel": resolved_default_model(),
            "failover": active_failover(),
            "accounts": account_state(),
            "cooldowns": [
                {
                    "key": cooldown.model,
                    "reason": cooldown.reason,
                    "resetsInSeconds": cooldown.remaining_seconds,
                }
                for cooldown in active_cooldowns()
            ],
        }
    )


@providers_bp.get("/v1/accounts")
def list_chatgpt_accounts() -> Response:
    return _json({"accounts": account_state()})


@providers_bp.post("/v1/accounts/preserve")
def preserve_account() -> Response:
    """Keep the signed-in account before another sign-in replaces it.

    The login flow writes `auth.json` unconditionally, so this is what turns
    "switch account" into "add account".
    """
    from .accounts import preserve_current_account

    preserved = preserve_current_account()
    return _json(
        {
            "preserved": preserved is not None,
            "account": preserved.label if preserved is not None else None,
            "accounts": account_state(),
        }
    )


@providers_bp.delete("/v1/accounts/<path:key>")
def delete_chatgpt_account(key: str) -> Response:
    from .accounts import forget_account

    if not forget_account(key):
        return _json(
            {"error": {"message": "That account is not one of the additional accounts."}}, 404
        )
    return _json({"accounts": account_state()})
