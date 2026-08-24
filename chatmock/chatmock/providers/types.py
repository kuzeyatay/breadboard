from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol

ChatMessage = Dict[str, Any]


class ProviderError(RuntimeError):
    """Raised when a model call fails. The message must stay safe to log; raw
    provider payloads (which may echo API keys or internal URLs) must not be
    embedded verbatim.

    ``status_code`` carries the upstream's own HTTP status when the raise site
    knew it. Health tracking reads it first and only falls back to matching the
    prose, because a status is unambiguous and a message never quite is.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        phase: Optional[str] = None,
        partial_output: bool = False,
        replay_safe: bool = False,
        code: Optional[str] = None,
        elapsed_seconds: Optional[float] = None,
        websocket_close_code: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        # Transport metadata is kept separate from the safe, human-readable
        # message. ProviderRouter copies these fields into its secret-free
        # attempt ledger, which makes a pre-output connect failure
        # distinguishable from a stream that broke after the model had begun
        # answering without ever persisting the answer itself.
        self.phase = phase
        self.partial_output = bool(partial_output)
        # A missing observed fragment does not prove that a request was never
        # accepted. Providers opt in only for a failure that happened before the
        # request was sent or for an explicit terminal upstream rejection.
        self.replay_safe = (
            bool(replay_safe)
            and not self.partial_output
            and phase not in {"send", "receive", "protocol"}
        )
        self.code = code
        self.elapsed_seconds = elapsed_seconds
        self.websocket_close_code = websocket_close_code


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
    # The outer client model id before `default` expansion. Council calls may
    # have their own requested seat model, so keep both identities.
    client_requested_model: Optional[str] = None
    # Correlates every upstream attempt made for this logical call.
    request_id: Optional[str] = None
    # Durable bound requests cannot turn one logical call into another account
    # POST after a quota/terminal response.
    allow_account_failover: bool = True
    # Strict Learn calls also disable provider HTTP helpers' otherwise-safe
    # pre-connect replay, preserving exactly one provider POST per logical call.
    allow_transport_retry: bool = True
    # Out-param populated by ProviderRouter. Each row names the actual upstream
    # model and whether it was a failover attempt.
    model_attempts_out: List[Dict[str, Any]] = field(default_factory=list)
    # Secret-free checkpoints for a provider recovery that supplied explicit
    # non-acceptance/idempotency proof. Merely buffering fragments does not make
    # an accepted model request safe to replay.
    transport_recoveries_out: List[Dict[str, Any]] = field(default_factory=list)


class ModelProvider(Protocol):
    def call_model(self, call: ModelCall) -> str:
        """Run one chat call and return the assistant text. Raises ProviderError."""
        ...
