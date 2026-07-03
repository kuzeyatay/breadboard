from __future__ import annotations

from typing import Optional

from ..council.policy import CouncilConfig
from .chatgpt_upstream import ChatGptUpstreamProvider
from .types import ModelCall


def _is_external_model_id(model: str) -> bool:
    """External provider ids look like 'vendor/model'; ChatMock uses GPT ids."""
    return "/" in (model or "")


class ProviderRouter:
    """ChatMock-only provider router.

    Every Council model call goes through ChatMock's existing ChatGPT OAuth
    upstream. Legacy external provider ids are remapped to the configured
    ChatGPT fallback so old env/config values cannot route outside ChatMock.
    """

    def __init__(
        self,
        config: CouncilConfig,
        upstream: Optional[ChatGptUpstreamProvider] = None,
    ) -> None:
        self.config = config
        self.upstream = upstream or ChatGptUpstreamProvider()

    def effective_model(self, model: str) -> str:
        if _is_external_model_id(model):
            return self.config.upstream_fallback_model
        return model or self.config.upstream_fallback_model

    def call_model(self, call: ModelCall) -> str:
        model = self.effective_model(call.model)
        return self.upstream.call_model(
            ModelCall(
                model=model,
                messages=call.messages,
                system=call.system,
                temperature=call.temperature,
                max_tokens=call.max_tokens,
            )
        )
