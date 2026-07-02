from __future__ import annotations

from typing import Optional

from ..council.policy import CouncilConfig
from .chatgpt_upstream import ChatGptUpstreamProvider
from .openrouter import OpenRouterProvider
from .types import ModelCall, ProviderError


def _is_provider_prefixed(model: str) -> bool:
    """OpenRouter-style ids look like 'anthropic/claude-sonnet-4.5'."""
    return "/" in (model or "")


class ProviderRouter:
    """Chooses a concrete provider per model id.

    - provider-prefixed ids ("vendor/model") go to OpenRouter when a key is
      configured;
    - everything else — and every call when OpenRouter is unavailable — goes
      through ChatMock's existing ChatGPT OAuth upstream, remapped to the
      configured upstream fallback model where needed.
    """

    def __init__(
        self,
        config: CouncilConfig,
        openrouter: Optional[OpenRouterProvider] = None,
        upstream: Optional[ChatGptUpstreamProvider] = None,
    ) -> None:
        self.config = config
        if openrouter is None and config.openrouter_api_key:
            openrouter = OpenRouterProvider(
                api_key=config.openrouter_api_key,
                base_url=config.openrouter_base_url,
                timeout_seconds=config.request_timeout_seconds,
            )
        self.openrouter = openrouter
        self.upstream = upstream or ChatGptUpstreamProvider()

    @property
    def openrouter_available(self) -> bool:
        return self.openrouter is not None

    def effective_model(self, model: str) -> str:
        if _is_provider_prefixed(model) and not self.openrouter_available:
            return self.config.upstream_fallback_model
        return model

    def call_model(self, call: ModelCall) -> str:
        model = call.model or self.config.upstream_fallback_model
        if _is_provider_prefixed(model):
            if self.openrouter_available:
                return self.openrouter.call_model(
                    ModelCall(
                        model=model,
                        messages=call.messages,
                        system=call.system,
                        temperature=call.temperature,
                        max_tokens=call.max_tokens,
                    )
                )
            # No OpenRouter key: fill the council seat with the upstream model.
            model = self.config.upstream_fallback_model
        return self.upstream.call_model(
            ModelCall(
                model=model,
                messages=call.messages,
                system=call.system,
                temperature=call.temperature,
                max_tokens=call.max_tokens,
            )
        )
