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
from .providers import chatgpt_web, dispatch
from .providers.catalog import KIND_CHATGPT_OAUTH, provider_spec
from .providers.types import ProviderError
from .accounts import account_state
from .providers.registry import active_failover
from .providers.registry import default_model as resolved_default_model
from .providers.registry import chat_model as resolved_chat_model
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
        # A running chat's pin; otherwise it follows the shared default above.
        "chatModel": resolved_chat_model(),
        "storedChatModel": store.read_settings().chat_model,
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


# --- OpenAI (web): the signed-in chatgpt.com tab ---------------------------
#
# No credential is ever posted here. Sign-in happens in the browser tab the
# page module opens; these routes only start it, report it, and end it. The
# `tab-requests` pair is the relay through which a Breadboard page lends the
# desktop shell's browser to ChatMock (see "The shell bridge" in chatgpt_web).


@providers_bp.get("/v1/providers/openaiweb/session")
def chatgpt_web_session() -> Response:
    refresh = request.args.get("refresh") in ("1", "true", "yes")
    return _json(chatgpt_web.session_state(refresh=refresh))


@providers_bp.post("/v1/providers/openaiweb/login")
def chatgpt_web_login() -> Response:
    return _json(chatgpt_web.start_login())


@providers_bp.post("/v1/providers/openaiweb/login/cancel")
def chatgpt_web_cancel_login() -> Response:
    return _json(chatgpt_web.cancel_login())


@providers_bp.post("/v1/providers/openaiweb/logout")
def chatgpt_web_logout() -> Response:
    return _json(chatgpt_web.logout())


@providers_bp.post("/v1/providers/openaiweb/sync")
def chatgpt_web_sync() -> Response:
    state = chatgpt_web.sync_models()
    return _json(state, 200 if not state.get("error") else 502)


@providers_bp.get("/v1/providers/openaiweb/tab-requests")
def chatgpt_web_tab_requests() -> Response:
    """Long-poll: requests for the shell's ChatGPT tab, held up to ``wait`` s."""
    try:
        wait = float(request.args.get("wait") or 0)
    except ValueError:
        wait = 0.0
    cdp_port = request.args.get("cdpPort")
    if cdp_port and cdp_port.isdigit():
        chatgpt_web.note_agent_seen(int(cdp_port))
    return _json({"requests": chatgpt_web.pending_tab_requests(wait=wait), "bridge": chatgpt_web.bridge_state()})


@providers_bp.post("/v1/providers/openaiweb/tab-requests/<nonce>")
def chatgpt_web_answer_tab_request(nonce: str) -> Response:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _json({"error": {"message": "expected a JSON object"}}, 400)
    accepted = chatgpt_web.answer_tab_request(nonce, payload)
    return _json({"accepted": accepted}, 200 if accepted else 404)


@providers_bp.get("/v1/settings/default-model")
def get_default_model() -> Response:
    settings = store.read_settings()
    return _json(
        {
            "defaultModel": resolved_default_model(),
            "storedDefaultModel": settings.default_model,
        }
    )


def _read_model_choice(payload: Any, *, allow_no_model: bool = False) -> tuple[str | None, Response | None]:
    """The model id a settings PUT names, or the 400 that refuses it.

    An id no configured provider can serve is refused here, so a setting
    cannot silently break every subsystem that asks for its sentinel.
    """
    if not isinstance(payload, dict):
        return None, _json({"error": {"message": "Request body must be a JSON object"}}, 400)

    model = payload.get("model")
    if model is not None and not isinstance(model, str):
        return None, _json({"error": {"message": "model must be a string"}}, 400)

    if isinstance(model, str) and model.strip().lower() == store.NO_MODEL_SENTINEL:
        if allow_no_model:
            return store.NO_MODEL_SENTINEL, None
        return None, _json({"error": {"message": "Choose a model for this chat."}}, 400)

    if isinstance(model, str) and model.strip():
        from .providers.registry import resolve_model
        from .providers.registry import NoDefaultModelError

        try:
            resolved = resolve_model(model)
        except NoDefaultModelError as exc:
            return None, _json({"error": {"message": str(exc), "code": exc.code}}, 400)
        if not resolved.is_chatgpt:
            try:
                dispatch.credentials_for(resolved.provider)
            except Exception as exc:
                return None, _json({"error": {"message": str(exc)}}, 400)
    return model, None


@providers_bp.route("/v1/settings/default-model", methods=["PUT", "POST"])
def put_default_model() -> Response:
    model, refusal = _read_model_choice(request.get_json(silent=True), allow_no_model=True)
    if refusal is not None:
        return refusal
    if not store.set_default_model(model):
        return _json({"error": {"message": "The default model could not be saved"}}, 500)
    return _json(_state_payload())


@providers_bp.get("/v1/settings/chat-model")
def get_chat_model() -> Response:
    settings = store.read_settings()
    return _json(
        {
            "chatModel": resolved_chat_model(),
            "storedChatModel": settings.chat_model,
            "defaultModel": resolved_default_model(),
        }
    )


@providers_bp.route("/v1/settings/chat-model", methods=["PUT", "POST"])
def put_chat_model() -> Response:
    """Pin a running chat to its concrete model without changing the default.

    Saving Breadboard's shared default clears this override. Hermes can pin
    it again when a turn explicitly requests a provider-prefixed model.
    """
    model, refusal = _read_model_choice(request.get_json(silent=True))
    if refusal is not None:
        return refusal
    if not store.set_chat_model(model):
        return _json({"error": {"message": "The chat model could not be saved"}}, 500)
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


@providers_bp.get("/v1/settings/usage")
def chatgpt_usage() -> Response:
    """OpenAI's own usage report for one signed-in account, reserve included.

    `?account=<key or email>` picks the account; the default is the primary —
    the one the user chose, which is the one whose reserve they are asking
    about when a spent plan window has moved them onto Luna. Reading the
    report spends no quota, so the dashboard may poll it.
    """
    from .accounts import list_accounts, select_account
    from .codex_usage import CodexUsageError, fetch_codex_usage

    wanted = (request.args.get("account") or "").strip().lower()
    accounts = list_accounts()
    if not accounts:
        return _json({"error": {"message": "No ChatGPT account is signed in."}}, 404)
    account = accounts[0]
    if wanted:
        matches = [
            row for row in accounts
            if row.key.lower() == wanted or (row.email or "").lower() == wanted
        ]
        if not matches:
            return _json({"error": {"message": "That account is not signed in."}}, 404)
        account = matches[0]
    try:
        usage = fetch_codex_usage(account.auth, account.path)
    except CodexUsageError as exc:
        return _json({"error": {"message": str(exc)}, "account": account.label}, 502)
    serving = select_account()
    usage.update(
        {
            "account": account.label,
            "account_key": account.key,
            "primary_account": account.primary,
            "serving": serving is not None and serving.key == account.key,
        }
    )
    if usage.get("email") is None and account.email:
        usage["email"] = account.email
    if usage.get("plan") is None and account.plan:
        usage["plan"] = account.plan
    return _json(usage)


@providers_bp.get("/v1/usage/ledger")
def usage_ledger_report() -> Response:
    """Who spent what: the usage ledger, newest first, with aggregates.

    `?since=` takes an ISO timestamp or a duration (`5h`, `24h`, `7d`; the
    default is 7 days), `?limit=` caps the rows returned (default 400, max
    2000), `?account=` filters to one account key/email and `?source=` to one
    origin. The aggregates are computed over every matching row inside
    `since`, not only the rows returned.
    """
    from datetime import datetime, timedelta, timezone
    import re

    from . import usage_ledger

    raw_since = (request.args.get("since") or "7d").strip()
    now = datetime.now(timezone.utc)
    since: datetime | None = None
    duration = re.fullmatch(r"(\d+)([hdm])", raw_since.lower())
    if duration:
        amount, unit = int(duration.group(1)), duration.group(2)
        since = now - timedelta(**{{"h": "hours", "d": "days", "m": "minutes"}[unit]: amount})
    elif raw_since:
        try:
            since = datetime.fromisoformat(raw_since.replace("Z", "+00:00"))
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
        except ValueError:
            return _json({"error": {"message": "since must be an ISO timestamp or a duration like 24h or 7d."}}, 400)
    try:
        limit = max(1, min(2000, int(request.args.get("limit") or 400)))
    except ValueError:
        limit = 400
    account = (request.args.get("account") or "").strip() or None
    source = (request.args.get("source") or "").strip() or None

    rows = usage_ledger.read_rows(since=since, limit=20_000, account=account, source=source)
    summary = usage_ledger.summarize(rows, now=now)
    return _json(
        {
            "generatedAt": now.isoformat().replace("+00:00", "Z"),
            "since": since.isoformat().replace("+00:00", "Z") if since else None,
            "path": usage_ledger.ledger_path(),
            "rows": rows[:limit],
            "truncated": len(rows) > limit,
            "summary": summary,
            "accounts": account_state(),
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


@providers_bp.post("/v1/accounts/<path:key>/activate")
def activate_chatgpt_account(key: str) -> Response:
    """Make one of the additional accounts the primary — the one requests use.

    Activating clears the account's quota cooldown, so the reply also says what
    that cooldown was: a plan window that is really still spent will put the
    account straight back to rest on the next request, and the client should
    be able to say so instead of reporting a switch that silently undoes itself.
    """
    from . import failover
    from .accounts import COOLDOWN_PREFIX, activate_account

    resting = failover.cooldown_for(f"{COOLDOWN_PREFIX}{key}")
    if not activate_account(key):
        return _json(
            {"error": {"message": "That account could not be made the active one."}}, 404
        )
    return _json(
        {
            "accounts": account_state(),
            "wasResting": (
                {"reason": resting.reason, "remainingSeconds": resting.remaining_seconds}
                if resting is not None and resting.remaining_seconds > 0
                else None
            ),
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
