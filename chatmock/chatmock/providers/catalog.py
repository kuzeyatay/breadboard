from __future__ import annotations

"""Static catalog of the model providers ChatMock can reach.

ChatMock started as a ChatGPT-only proxy. Breadboard points every subsystem
(Hermes, UI-TARS, OpenCode, deep-research, the dashboard) at a single
OpenAI-compatible endpoint, so the cheapest way to gain multi-provider support
is to teach ChatMock itself to speak to more upstreams rather than to swap the
endpoint out. This module holds the provider definitions; credentials live in
``store.py`` and dispatch lives in the per-kind client modules.
"""

from dataclasses import dataclass, field
from typing import Dict, Iterable, Tuple

# Dispatch kinds. Each maps to one client implementation.
KIND_CHATGPT_OAUTH = "chatgpt_oauth"
KIND_OPENAI_COMPATIBLE = "openai_compatible"
KIND_ANTHROPIC = "anthropic"

CHATGPT_PROVIDER_ID = "chatgpt"


@dataclass(frozen=True)
class ProviderSpec:
    """One upstream ChatMock knows how to talk to.

    ``api_key_env`` lists the environment variables consulted (in order) when no
    key is stored in ``providers.json``. Keeping env fallbacks means existing
    deployments that already export ``ANTHROPIC_API_KEY`` work with no UI step.
    """

    id: str
    label: str
    kind: str
    default_base_url: str | None = None
    api_key_env: Tuple[str, ...] = ()
    base_url_env: Tuple[str, ...] = ()
    requires_api_key: bool = True
    # Base URL is user-supplied rather than fixed (self-hosted / gateway).
    base_url_editable: bool = False
    # Reasoning ("intelligence mode") levels this provider genuinely honours.
    # Empty means the provider has no notion of one, so the UI must not offer a
    # ladder that silently does nothing. Declared per provider rather than
    # guessed, because sending an unsupported field can be a hard 400.
    reasoning_efforts: Tuple[str, ...] = ()
    # Shown in the UI before a live model list is fetched.
    suggested_models: Tuple[str, ...] = ()
    docs_url: str | None = None
    description: str = ""


_SPECS: Tuple[ProviderSpec, ...] = (
    ProviderSpec(
        id=CHATGPT_PROVIDER_ID,
        label="ChatGPT",
        kind=KIND_CHATGPT_OAUTH,
        requires_api_key=False,
        suggested_models=(),
        docs_url="https://chatgpt.com",
        # The single home for ChatGPT. The subscription proxy can also sign into
        # it, but that path is not offered: it would mean two credentials for one
        # account and two ids per model, with fewer capabilities.
        description="Your ChatGPT subscription, signed in with OAuth.",
    ),
    ProviderSpec(
        id="anthropic",
        label="Anthropic",
        kind=KIND_ANTHROPIC,
        default_base_url="https://api.anthropic.com",
        api_key_env=("ANTHROPIC_API_KEY",),
        base_url_env=("ANTHROPIC_BASE_URL",),
        suggested_models=(
            "claude-opus-4-5",
            "claude-sonnet-4-5",
            "claude-haiku-4-5",
        ),
        docs_url="https://console.anthropic.com/settings/keys",
        description="Claude models through the Anthropic API.",
        reasoning_efforts=("low", "medium", "high"),
    ),
    ProviderSpec(
        id="google",
        # Gemini is reached through Google's own OpenAI-compatible layer rather
        # than the native generateContent API: it covers streaming, tool calls,
        # structured output and vision, so a second hand-written translator
        # would add failure modes without adding capability.
        label="Google Gemini",
        kind=KIND_OPENAI_COMPATIBLE,
        default_base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        api_key_env=("GEMINI_API_KEY", "GOOGLE_API_KEY"),
        base_url_env=("GEMINI_BASE_URL",),
        suggested_models=(
            "gemini-2.5-pro",
            "gemini-2.5-flash",
        ),
        docs_url="https://aistudio.google.com/apikey",
        description="Gemini models through Google AI Studio.",
        reasoning_efforts=("low", "medium", "high"),
    ),
    ProviderSpec(
        id="openai",
        label="OpenAI",
        kind=KIND_OPENAI_COMPATIBLE,
        default_base_url="https://api.openai.com/v1",
        api_key_env=("OPENAI_API_KEY",),
        base_url_env=("OPENAI_API_BASE_URL",),
        suggested_models=("gpt-6-astra", "gpt-5.1", "gpt-4.1", "o4-mini"),
        docs_url="https://platform.openai.com/api-keys",
        description="The OpenAI platform API, billed per token (separate from a ChatGPT plan).",
        reasoning_efforts=("low", "medium", "high"),
    ),
    ProviderSpec(
        id="openrouter",
        label="OpenRouter",
        kind=KIND_OPENAI_COMPATIBLE,
        default_base_url="https://openrouter.ai/api/v1",
        api_key_env=("OPENROUTER_API_KEY",),
        base_url_env=("OPENROUTER_BASE_URL",),
        suggested_models=(
            "anthropic/claude-sonnet-4.5",
            "google/gemini-2.5-pro",
            "meta-llama/llama-3.3-70b-instruct",
        ),
        docs_url="https://openrouter.ai/keys",
        description="One key for hundreds of models across vendors.",
        reasoning_efforts=("low", "medium", "high"),
    ),
    ProviderSpec(
        id="groq",
        label="Groq",
        kind=KIND_OPENAI_COMPATIBLE,
        default_base_url="https://api.groq.com/openai/v1",
        api_key_env=("GROQ_API_KEY",),
        base_url_env=("GROQ_BASE_URL",),
        suggested_models=("llama-3.3-70b-versatile", "qwen-2.5-32b"),
        docs_url="https://console.groq.com/keys",
        description="Open-weight models on Groq's low-latency inference.",
    ),
    ProviderSpec(
        id="deepseek",
        label="DeepSeek",
        kind=KIND_OPENAI_COMPATIBLE,
        default_base_url="https://api.deepseek.com/v1",
        api_key_env=("DEEPSEEK_API_KEY",),
        base_url_env=("DEEPSEEK_BASE_URL",),
        suggested_models=("deepseek-chat", "deepseek-reasoner"),
        docs_url="https://platform.deepseek.com/api_keys",
        description="DeepSeek chat and reasoning models.",
    ),
    ProviderSpec(
        id="xai",
        label="xAI",
        kind=KIND_OPENAI_COMPATIBLE,
        default_base_url="https://api.x.ai/v1",
        api_key_env=("XAI_API_KEY",),
        base_url_env=("XAI_BASE_URL",),
        suggested_models=("grok-4", "grok-4-fast"),
        docs_url="https://console.x.ai",
        description="Grok models through the xAI API.",
    ),
    ProviderSpec(
        id="mistral",
        label="Mistral",
        kind=KIND_OPENAI_COMPATIBLE,
        default_base_url="https://api.mistral.ai/v1",
        api_key_env=("MISTRAL_API_KEY",),
        base_url_env=("MISTRAL_BASE_URL",),
        suggested_models=("mistral-large-latest", "mistral-small-latest"),
        docs_url="https://console.mistral.ai/api-keys",
        description="Mistral's hosted models.",
    ),
    ProviderSpec(
        id="together",
        label="Together AI",
        kind=KIND_OPENAI_COMPATIBLE,
        default_base_url="https://api.together.xyz/v1",
        api_key_env=("TOGETHER_API_KEY",),
        base_url_env=("TOGETHER_BASE_URL",),
        suggested_models=("meta-llama/Llama-3.3-70B-Instruct-Turbo",),
        docs_url="https://api.together.ai/settings/api-keys",
        description="Open models hosted by Together.",
    ),
    # No Ollama entry. Needing no API key, it counted as configured purely
    # because a default base URL exists — so its models appeared in the picker
    # whether or not anything was listening on 11434, and picking one failed.
    # A local Ollama is still reachable through the `custom` provider below,
    # which stays unconfigured until a base URL is actually supplied.
    #
    # (Unrelated to `routes_ollama.py`, which is ChatMock *serving* an
    # Ollama-shaped API to Ollama clients.)
    ProviderSpec(
        id="cliproxy",
        label="Subscriptions",
        kind=KIND_OPENAI_COMPATIBLE,
        # Google/Gemini, Kimi and Grok use the CLIProxyAPI sibling service.
        # Claude ids in this same public namespace are intercepted by dispatch
        # and served by the official Claude Code CLI instead. The bearer below
        # remains only a loopback secret for the proxy-backed subscriptions.
        default_base_url="http://127.0.0.1:8317/v1",
        api_key_env=("CLIPROXY_API_KEY",),
        base_url_env=("CLIPROXY_BASE_URL",),
        requires_api_key=False,
        base_url_editable=True,
        # Deliberately empty: which models exist depends on which accounts are
        # signed in, so the dashboard syncs the live list after each sign-in
        # instead of ChatMock guessing.
        suggested_models=(),
        docs_url="https://github.com/router-for-me/CLIProxyAPI",
        description="Models from subscriptions you already pay for, signed in with OAuth. No API key.",
        reasoning_efforts=("low", "medium", "high"),
    ),
    ProviderSpec(
        id="custom",
        label="Custom endpoint",
        kind=KIND_OPENAI_COMPATIBLE,
        default_base_url=None,
        api_key_env=("CUSTOM_OPENAI_API_KEY",),
        base_url_env=("CUSTOM_OPENAI_BASE_URL",),
        requires_api_key=False,
        base_url_editable=True,
        suggested_models=(),
        description="Any other OpenAI-compatible server. Supply its base URL.",
    ),
)

_BY_ID: Dict[str, ProviderSpec] = {spec.id: spec for spec in _SPECS}


def iter_provider_specs() -> Iterable[ProviderSpec]:
    return _SPECS


def provider_spec(provider_id: str | None) -> ProviderSpec | None:
    if not isinstance(provider_id, str):
        return None
    return _BY_ID.get(provider_id.strip().lower())


def provider_ids() -> Tuple[str, ...]:
    return tuple(spec.id for spec in _SPECS)


def is_known_provider(provider_id: str | None) -> bool:
    return provider_spec(provider_id) is not None
