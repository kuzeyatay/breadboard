from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol

ChatMessage = Dict[str, Any]


class ProviderError(RuntimeError):
    """Raised when a model call fails. The message must stay safe to log; raw
    provider payloads (which may echo API keys or internal URLs) must not be
    embedded verbatim."""


@dataclass
class ModelCall:
    model: str
    messages: List[ChatMessage]
    system: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    # Out-param: providers set this to the model's reasoning-summary trace (the
    # "thinking") when the upstream streams it, so the council can surface it.
    reasoning_out: Optional[str] = None


class ModelProvider(Protocol):
    def call_model(self, call: ModelCall) -> str:
        """Run one chat call and return the assistant text. Raises ProviderError."""
        ...
