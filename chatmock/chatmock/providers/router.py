from __future__ import annotations

from typing import Optional

from .. import failover, provider_health
from ..council.policy import CouncilConfig
from ..model_telemetry import record_model_attempt
from . import dispatch, registry
from .chatgpt_upstream import ChatGptUpstreamProvider
from .registry import resolve_model
from .types import ModelCall, ProviderError


class ProviderRouter:
    """Routes each Council model call to the provider that owns its model id.

    ChatGPT-shaped ids (``gpt-5.6-sol``) keep going through ChatMock's OAuth
    upstream, which is still the default for every seat. Provider-prefixed ids
    (``anthropic/claude-opus-4-5``) go to that provider once the user has
    configured it; if it is not configured the call falls back to the ChatGPT
    upstream rather than failing the run, so a half-finished provider setup
    degrades instead of breaking the council.
    """

    def __init__(
        self,
        config: CouncilConfig,
        upstream: Optional[ChatGptUpstreamProvider] = None,
    ) -> None:
        self.config = config
        self.upstream = upstream or ChatGptUpstreamProvider()

    def effective_model(self, model: str) -> str:
        """The public model id this call will actually run on."""
        resolved = self._route(model)
        return resolved.upstream_model if resolved.is_chatgpt else resolved.public_model

    def _route(self, model: str):
        resolved = resolve_model(model or self.config.upstream_fallback_model)
        if resolved.is_unknown_external:
            return resolve_model(self.config.upstream_fallback_model)
        if not resolved.is_chatgpt:
            try:
                dispatch.credentials_for(resolved.provider)
            except ProviderError:
                return resolve_model(self.config.upstream_fallback_model)
        # A provider that has just failed several calls in a row will fail this
        # one too. Stepping over it here is what turns a bad ten minutes from
        # "every request waits out the retry ladder" into "requests keep
        # working" — and the fallback is only taken while the cooldown holds.
        if provider_health.is_unhealthy(resolved.provider.id):
            fallback = resolve_model(self.config.upstream_fallback_model)
            if not provider_health.is_unhealthy(fallback.provider.id):
                return fallback
        return resolved

    def call_model(self, call: ModelCall) -> str:
        resolved = self._route(call.model)
        try:
            requested_resolution = resolve_model(
                call.model or self.config.upstream_fallback_model
            )
            substituted = (
                requested_resolution.provider.id != resolved.provider.id
                or requested_resolution.upstream_model != resolved.upstream_model
            )
            return self._attempt(call, resolved, fallback=substituted)
        except ProviderError as exc:
            status = getattr(exc, "status_code", None)
            public = resolved.public_model if not resolved.is_chatgpt else resolved.upstream_model

            # "Out of quota" is not a failed call to report — the model cannot
            # answer for hours or days. Record that so `default` stops choosing
            # it, then serve this request from a healthy model rather than
            # failing a run the user can do nothing about.
            if failover.is_quota_error(status, str(exc)):
                failover.note_exhausted(public, reason=str(exc))
                return self._serve_from_fallback(call, public, exc)

            # A provider that is merely failing gets counted rather than acted
            # on. Only the call that pushes it over the threshold reroutes, so
            # one bad response never moves a user off the model they chose.
            outage = provider_health.note_failure(
                resolved.provider.id,
                reason=str(exc),
                status_code=status,
            )
            if outage is None:
                raise
            return self._serve_from_fallback(call, public, exc)

    def _serve_from_fallback(self, call: ModelCall, public: str, original: ProviderError) -> str:
        """Answer this request from the best model that is not currently ruled out.

        Shared by both reasons a model becomes unusable, because from here they
        are the same problem: something healthy has to answer, and if nothing is,
        the user should see the failure that started it rather than whichever
        substitute happened to be tried last.
        """
        for candidate in registry.healthy_fallbacks(public):
            routed = self._route(candidate)
            try:
                return self._attempt(call, routed, fallback=True)
            except ProviderError as exc:
                # That one is unusable too; keep the original explanation, but
                # still count the failure — a substitute that is also down is
                # exactly what the next request needs to know.
                provider_health.note_failure(
                    routed.provider.id,
                    reason=str(exc),
                    status_code=getattr(exc, "status_code", None),
                )
                continue
        raise original

    def _attempt(self, call: ModelCall, resolved, *, fallback: bool) -> str:
        """Invoke one resolved model and retain its exact routing identity."""
        try:
            result = self._invoke(call, resolved)
        except ProviderError as exc:
            outcome = (
                "quota_exhausted"
                if failover.is_quota_error(None, str(exc))
                else "failed"
            )
            self._record_attempt(
                call,
                resolved,
                outcome=outcome,
                fallback=fallback,
                error=str(exc),
            )
            raise
        self._record_attempt(
            call,
            resolved,
            outcome="succeeded",
            fallback=fallback,
        )
        # Health is proven by a call that worked, not by a timer running out, so
        # a provider that recovers mid-cooldown is usable again at once.
        provider_health.note_success(resolved.provider.id)
        dispatch.clear_recovered_model(resolved)
        return result

    @staticmethod
    def _record_attempt(
        call: ModelCall,
        resolved,
        *,
        outcome: str,
        fallback: bool,
        error: str | None = None,
    ) -> None:
        entry = record_model_attempt(
            request_id=call.request_id,
            endpoint="council",
            client_requested_model=call.client_requested_model,
            requested_model=call.model,
            resolved_model=resolved.public_model,
            upstream_model=resolved.upstream_model,
            provider=resolved.provider.id,
            outcome=outcome,
            fallback=fallback,
            error=error,
        )
        call.model_attempts_out.append(entry)

    def _invoke(self, call: ModelCall, resolved) -> str:
        routed_call = ModelCall(
            model=resolved.upstream_model,
            messages=call.messages,
            system=call.system,
            temperature=call.temperature,
            max_tokens=call.max_tokens,
            reasoning_effort=call.reasoning_effort,
            reasoning_summary=call.reasoning_summary,
        )
        try:
            if resolved.is_chatgpt:
                return self.upstream.call_model(routed_call)
            return dispatch.call_model(routed_call, resolved)
        finally:
            # The runtime owns the original call. Copy provider out-params back
            # even when a routed model id required a replacement call object.
            call.reasoning_out = routed_call.reasoning_out
            call.usage_out = routed_call.usage_out
