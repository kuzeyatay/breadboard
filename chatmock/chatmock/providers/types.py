from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol

ChatMessage = Dict[str, Any]


class ProviderError(RuntimeError):
    """Raised when a model call fails. The message must stay safe to log; raw
    provider payloads (which may echo API keys or internal URLs) must not be
    embedded verbatim."""


@dataclass(frozen=True)
class ModelTokenUsage:
    """Authoritative token accounting returned by one upstream model call."""

    input_tokens: int
    output_tokens: int
    total_tokens: int
    cached_input_tokens: int = 0
    reasoning_tokens: int = 0


@dataclass
class ModelCall:
    model: str
    messages: List[ChatMessage]
    system: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    # Per-request reasoning overrides. Council must preserve these through
    # every seat and the chairman instead of falling back to server defaults.
    reasoning_effort: Optional[str] = None
    reasoning_summary: Optional[str] = None
    # Out-param: providers set this to the model's reasoning-summary trace (the
    # "thinking") when the upstream streams it, so the council can surface it.
    reasoning_out: Optional[str] = None
    # Out-param populated from response.completed.response.usage when the
    # upstream reports authoritative Responses API token accounting.
    usage_out: Optional[ModelTokenUsage] = None


class ModelProvider(Protocol):
    def call_model(self, call: ModelCall) -> str:
        """Run one chat call and return the assistant text. Raises ProviderError."""
        ...
