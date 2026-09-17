from __future__ import annotations

"""Model-id resolution across every configured provider.

Public model ids stay OpenAI-shaped so existing clients keep working:

* ``gpt-5.6-sol``                    -> the ChatGPT OAuth upstream (unchanged)
* ``anthropic/claude-opus-4-5``      -> Anthropic
* ``openrouter/openai/gpt-4.1``      -> OpenRouter, upstream id ``openai/gpt-4.1``
* ``default``                        -> whatever model the user picked globally

Only the first path segment is treated as a provider id, and only when it names
a provider ChatMock knows. That keeps vendor-scoped ids like
``meta-llama/Llama-3.3-70B`` intact when they are sent to a provider whose own
catalog uses slashes.
"""

from dataclasses import dataclass
from typing import Any, Dict, List

from ..model_registry import (
    ALL_REASONING_EFFORTS,
    DEFAULT_MODEL,
    allowed_efforts_for_model,
    model_spec_for_name,
    normalize_model_name,
)
from .catalog import (
    CHATGPT_PROVIDER_ID,
    KIND_CHATGPT_OAUTH,
    KIND_CHATGPT_WEB,
    ProviderSpec,
    iter_provider_specs,
    provider_spec,
)
from . import store
from .types import ProviderError


class NoDefaultModelError(ProviderError):
    def __init__(self) -> None:
        super().__init__(
            "No default model is selected. Choose a model for this task or set a default model in your profile.",
            status_code=400,
            code="default_model_required",
        )


@dataclass(frozen=True)
class ResolvedModel:
    """A public model id mapped onto the provider that can serve it."""

    provider: ProviderSpec
    # Model id as the upstream expects it (no provider prefix).
    upstream_model: str
    # Model id as the client asked for it, after sentinel expansion.
    public_model: str
    # True when the id was vendor-prefixed but named no provider ChatMock knows
    # (a stale `COUNCIL_MODELS=legacy/model-a`, say). Such an id is not a valid
    # ChatGPT model either, so callers substitute their own fallback rather than
    # forwarding it upstream.
    is_unknown_external: bool = False

    @property
    def is_chatgpt(self) -> bool:
        return self.provider.kind == KIND_CHATGPT_OAUTH


def _split_provider_prefix(model: str) -> tuple[ProviderSpec | None, str]:
    if "/" not in model:
        return None, model
    head, _, tail = model.partition("/")
    spec = provider_spec(head)
    if spec is None or not tail.strip():
        return None, model
    return spec, tail.strip()


def resolve_model(model: Any, *, _expanded: bool = False) -> ResolvedModel:
    """Map a requested model id onto a provider.

    Unknown or unprefixed ids fall back to the ChatGPT upstream, which is what
    every pre-existing ChatMock client expects.
    """
    raw = model.strip() if isinstance(model, str) else ""

    if raw.lower() == store.NO_MODEL_SENTINEL:
        raise NoDefaultModelError()

    if store.is_default_sentinel(raw):
        if _expanded:
            # A default that points at another sentinel would loop; stop here.
            return _chatgpt_resolution(DEFAULT_MODEL)
        background = store.get_default_model(DEFAULT_MODEL)
        if store.is_chat_sentinel(raw):
            return resolve_model(store.get_chat_model(background), _expanded=True)
        return resolve_model(background, _expanded=True)

    spec, remainder = _split_provider_prefix(raw)
    if spec is None:
        return _chatgpt_resolution(raw, unknown_external="/" in raw)
    if spec.kind == KIND_CHATGPT_OAUTH:
        return _chatgpt_resolution(remainder)

    return ResolvedModel(provider=spec, upstream_model=remainder, public_model=f"{spec.id}/{remainder}")


def _chatgpt_resolution(model: str, *, unknown_external: bool = False) -> ResolvedModel:
    spec = provider_spec(CHATGPT_PROVIDER_ID)
    assert spec is not None  # the catalog always defines ChatGPT
    upstream = normalize_model_name(model)
    return ResolvedModel(
        provider=spec,
        upstream_model=upstream,
        public_model=model or upstream,
        is_unknown_external=unknown_external,
    )


def preferred_model() -> str:
    """The model the user chose, regardless of whether it can serve right now."""
    return store.get_default_model(DEFAULT_MODEL)


def is_unavailable(model: str) -> bool:
    """Whether a model cannot serve right now, for either reason it might not.

    The two reasons are genuinely different — the model is out of quota, or the
    provider behind it is failing — but every caller choosing what to run wants
    the same answer, and asking only one of the two questions is how a request
    gets routed straight at something that just failed three times.
    """
    from .. import failover, provider_health

    if failover.is_cooling(model):
        return True
    return provider_health.is_unhealthy(resolve_model(model).provider.id)


def drives_a_browser(model: str) -> bool:
    """Whether serving this model means typing into the person's own browser.

    A browser-driven provider is one page holding one conversation at a time,
    answered at the speed a person reads. It is a model someone asks for on
    purpose, never one to quietly hand background work to: measured
    2026-09-14, a single stand-in call for an exhausted default took the page
    for two and a half minutes, and the chat the person was sitting in front
    of was refused three times while it did.
    """
    try:
        return resolve_model(model).provider.kind == KIND_CHATGPT_WEB
    except Exception:  # noqa: BLE001 - an unresolvable id is not a browser one
        return False


def healthy_fallbacks(exclude: str) -> List[str]:
    """Models that could stand in for an unusable one, best first.

    The built-in ChatGPT model (``DEFAULT_MODEL``) is the *last* layer, never
    the first. It used to lead on the reasoning that the configured default is
    the least surprising place to land — but it is the build's default, not
    the person's, and a paid weekly window. Leading with it meant every
    rate-limit flap on a free or subscription model (134 Gemini 429s in seven
    minutes; a burst of OpenRouter stealth 429s on 2026-09-16) spent that
    window on the person's behalf, and once it was spent, an exhausted
    ChatGPT account was still the first thing every fallback tried. The other
    configured external models stand in first; ChatGPT answers only when none
    of them can. A browser-driven model is never offered at all - see
    ``drives_a_browser``.
    """
    candidates: List[str] = list(external_model_ids())
    if exclude != DEFAULT_MODEL:
        candidates.append(DEFAULT_MODEL)

    seen = {exclude}
    out: List[str] = []
    for candidate in candidates:
        if candidate in seen or is_unavailable(candidate):
            continue
        seen.add(candidate)
        if drives_a_browser(candidate):
            continue
        out.append(candidate)
    return out


def default_model() -> str:
    """The model `default` resolves to *right now*.

    Normally the user's choice. When that model cannot serve — its plan window
    is spent, or the provider behind it is failing — this steps over it to a
    healthy one, so every subsystem asking for `default` keeps working instead
    of each failing separately against a model that cannot answer. The user's
    choice is not overwritten: once it is usable again this returns to it on
    its own.
    """
    preferred = preferred_model()
    if preferred == store.NO_MODEL_SENTINEL:
        return preferred
    if not is_unavailable(preferred):
        return preferred

    for candidate in healthy_fallbacks(preferred):
        return candidate
    # Nothing is available: keep the user's choice so the error names the model
    # they actually picked.
    return preferred


def chat_model() -> str:
    """The model the `chat` sentinel resolves to right now: the composer's
    pick, or the background model while nothing has been picked for chat."""
    chosen = store.get_chat_model(preferred_model())
    if chosen == store.NO_MODEL_SENTINEL:
        return chosen
    if not is_unavailable(chosen):
        return chosen
    for candidate in healthy_fallbacks(chosen):
        return candidate
    return chosen


def active_failover() -> Dict[str, Any] | None:
    """What the UI shows when the chosen model is unavailable.

    Both reasons a model can be unusable land here, and the payload names which
    one applies: "out of quota until Thursday" and "Anthropic has failed four
    calls in a row" call for very different reactions from the person reading
    it, and a single undifferentiated "unavailable" would hide that.
    """
    from .. import failover, provider_health

    preferred = preferred_model()
    if preferred == store.NO_MODEL_SENTINEL:
        return None
    cooldown = failover.cooldown_for(preferred)
    outage = provider_health.outage_for(resolve_model(preferred).provider.id)
    if cooldown is None and outage is None:
        return None

    serving = default_model()
    payload: Dict[str, Any] = {
        "preferredModel": preferred,
        "servingModel": serving,
        "usingFallback": serving != preferred,
        "cause": "quota" if cooldown is not None else "provider_unhealthy",
        "reason": cooldown.reason if cooldown is not None else outage.reason,
        "resetsInSeconds": (
            cooldown.remaining_seconds if cooldown is not None else outage.remaining_seconds
        ),
    }
    if outage is not None:
        payload["providerOutage"] = outage.to_json()
    return payload


def provider_health_state() -> List[Dict[str, Any]]:
    """Every provider currently being stepped over, for the settings screen."""
    from .. import provider_health

    return [outage.to_json() for outage in provider_health.active_outages()]


def reasoning_efforts_for(model: Any) -> List[str]:
    """Reasoning levels a model genuinely honours, weakest first.

    This is what drives the "intelligence mode" choices in the UI. ChatGPT
    models vary per model, so they come from the model registry; other providers
    declare a fixed ladder in the catalog. An empty list means the model has no
    notion of reasoning effort and the UI must not offer one — a mode that
    silently does nothing is worse than no mode.
    """
    resolved = resolve_model(model)
    if resolved.is_chatgpt:
        allowed = allowed_efforts_for_model(resolved.upstream_model)
        # Order by the canonical ladder; drop 'none'/'minimal', which the UI
        # treats as "no reasoning" rather than a selectable depth.
        return [
            effort
            for effort in ALL_REASONING_EFFORTS
            if effort in allowed and effort not in ("none", "minimal")
        ]
    if resolved.provider.id == "openai" and model_spec_for_name(resolved.upstream_model):
        allowed = allowed_efforts_for_model(resolved.upstream_model)
        return [
            effort
            for effort in ALL_REASONING_EFFORTS
            if effort in allowed and effort not in ("none", "minimal")
        ]
    return list(resolved.provider.reasoning_efforts)


def external_model_ids() -> List[str]:
    """Prefixed model ids for every configured non-ChatGPT provider.

    Three layers, deduplicated in order: the catalog's suggestions, the ids the
    person pinned, and whatever the provider itself reports it serves right now
    (see ``discovery``), so a model released after this build still appears.
    """
    from . import chatgpt_web, discovery

    ids: List[str] = []
    for spec in iter_provider_specs():
        if spec.kind == KIND_CHATGPT_OAUTH:
            continue
        if not store.is_configured(spec):
            continue
        record = store.provider_record(spec.id)
        configured = list(spec.suggested_models) + list(record.models)
        if spec.kind == KIND_CHATGPT_WEB:
            # The signed-in page reported these; there is no endpoint to ask.
            listed = chatgpt_web.cached_model_ids() + configured
        else:
            listed = configured + discovery.discovered_models_for(spec, configured)
        for model in listed:
            candidate = f"{spec.id}/{model}"
            if candidate not in ids:
                ids.append(candidate)
    return ids


def model_entries(chatgpt_model_ids: List[str]) -> List[Dict[str, Any]]:
    """`/v1/models` payload rows for ChatGPT plus every configured provider.

    Each row carries `reasoning_efforts` so a client can offer exactly the
    intelligence modes that model supports, instead of a fixed GPT-shaped ladder.
    """
    entries: List[Dict[str, Any]] = [
        {
            "id": mid,
            "object": "model",
            "owned_by": CHATGPT_PROVIDER_ID,
            "reasoning_efforts": reasoning_efforts_for(mid),
        }
        for mid in chatgpt_model_ids
    ]
    for model_id in external_model_ids():
        provider_id = model_id.split("/", 1)[0]
        entries.append(
            {
                "id": model_id,
                "object": "model",
                "owned_by": provider_id,
                "reasoning_efforts": reasoning_efforts_for(model_id),
            }
        )
    return entries
