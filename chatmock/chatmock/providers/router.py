from __future__ import annotations

from typing import Any, Callable, Optional

from .. import failover, provider_health
from ..council.policy import CouncilConfig
from ..model_telemetry import record_model_attempt
from . import dispatch, registry
from .chatgpt_upstream import ChatGptUpstreamProvider
from .registry import resolve_model
from .types import ModelCall, ProviderError


def _observe(
    callback: Callable[..., Any],
    *args: Any,
    default: Any = None,
    **kwargs: Any,
) -> Any:
    """Run control-plane bookkeeping without changing a model outcome."""

    try:
        return callback(*args, **kwargs)
    except Exception:
        return default


def _is_quota_error(status_code: int | None, message: str) -> bool:
    return bool(
        _observe(
            failover.is_quota_error,
            status_code,
            message,
            default=False,
        )
    )


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
        if _observe(
            provider_health.is_unhealthy,
            resolved.provider.id,
            default=False,
        ):
            fallback = resolve_model(self.config.upstream_fallback_model)
            if not _observe(
                provider_health.is_unhealthy,
                fallback.provider.id,
                default=False,
            ):
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
            message = str(exc)

            # No observed fragment is not proof of non-acceptance. A provider
            # must explicitly classify a pre-send failure or terminal upstream
            # rejection as replay-safe before this logical call may fail over.
            if not getattr(exc, "replay_safe", False):
                _observe(
                    provider_health.note_failure,
                    resolved.provider.id,
                    reason=message,
                    status_code=status,
                )
                raise

            # "Out of quota" is not a failed call to report — the model cannot
            # answer for hours or days. Record that so `default` stops choosing
            # it, then serve this request from a healthy model rather than
            # failing a run the user can do nothing about.
            if _is_quota_error(status, message):
                _observe(failover.note_exhausted, public, reason=message)
                return self._serve_from_fallback(call, public, exc)

            # A provider that is merely failing gets counted rather than acted
            # on. Only the call that pushes it over the threshold reroutes, so
            # one bad response never moves a user off the model they chose.
            outage = _observe(
                provider_health.note_failure,
                resolved.provider.id,
                reason=message,
                status_code=status,
            )
            if outage is None:
                raise
            return self._serve_from_fallback(call, public, exc)

    def call_model_strict(self, call: ModelCall) -> str:
        """Invoke exactly the requested route with substitution disabled.

        The durable request hash binds the resolved model. Trying a healthy
        stand-in would turn one recoverable logical call into a different call
        whose answer cannot satisfy that binding.
        """
        # Callers should set these at construction, but the strict boundary is
        # authoritative even for a malformed/direct unit caller.
        call.allow_account_failover = False
        call.allow_transport_retry = False
        resolved = resolve_model(call.model)
        if resolved.is_unknown_external:
            raise ProviderError("strict recoverable model route is unavailable")
        if not dispatch.strict_single_attempt_supported(resolved):
            raise ProviderError("strict single-attempt model route is unavailable")
        if not resolved.is_chatgpt:
            # Validate configuration before the attempt without falling back.
            dispatch.credentials_for(resolved.provider)
        return self._attempt(call, resolved, fallback=False)

    def _serve_from_fallback(self, call: ModelCall, public: str, original: ProviderError) -> str:
        """Answer this request from the best model that is not currently ruled out.

        Shared by both reasons a model becomes unusable, because from here they
        are the same problem: something healthy has to answer, and if nothing is,
        the user should see the failure that started it rather than whichever
        substitute happened to be tried last.
        """
        candidates = _observe(
            lambda: list(registry.healthy_fallbacks(public)),
            default=[],
        )
        for candidate in candidates:
            try:
                routed = self._route(candidate)
            except Exception:
                # Candidate discovery is recovery bookkeeping. If it is broken,
                # the original authoritative ProviderError remains the answer.
                continue
            try:
                return self._attempt(call, routed, fallback=True)
            except ProviderError as exc:
                if not getattr(exc, "replay_safe", False):
                    raise
                # That one is unusable too; keep the original explanation, but
                # still count the failure — a substitute that is also down is
                # exactly what the next request needs to know.
                _observe(
                    provider_health.note_failure,
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
            status = getattr(exc, "status_code", None)
            outcome = (
                "quota_exhausted"
                if _is_quota_error(status, str(exc))
                else "failed"
            )
            self._record_attempt(
                call,
                resolved,
                outcome=outcome,
                fallback=fallback,
                error=str(exc),
                status_code=status,
                failure_phase=getattr(exc, "phase", None),
                partial_output=getattr(exc, "partial_output", False),
                replay_safe=getattr(exc, "replay_safe", False),
                error_code=getattr(exc, "code", None),
                elapsed_seconds=getattr(exc, "elapsed_seconds", None),
                websocket_close_code=getattr(exc, "websocket_close_code", None),
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
        _observe(provider_health.note_success, resolved.provider.id)
        _observe(dispatch.clear_recovered_model, resolved)
        return result

    @staticmethod
    def _record_attempt(
        call: ModelCall,
        resolved,
        *,
        outcome: str,
        fallback: bool,
        error: str | None = None,
        status_code: int | None = None,
        failure_phase: str | None = None,
        partial_output: bool | None = None,
        replay_safe: bool | None = None,
        error_code: str | None = None,
        elapsed_seconds: float | None = None,
        websocket_close_code: int | None = None,
    ) -> None:
        try:
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
                status_code=status_code,
                error=error,
                failure_phase=failure_phase,
                partial_output=partial_output,
                replay_safe=replay_safe,
                error_code=error_code,
                elapsed_seconds=elapsed_seconds,
                websocket_close_code=websocket_close_code,
                transport_recoveries=call.transport_recoveries_out,
                transport_recovered=(
                    outcome == "succeeded" and bool(call.transport_recoveries_out)
                ),
            )
            call.model_attempts_out.append(entry)
        except Exception:
            # Routing telemetry is strictly observational. A serialization,
            # filesystem, or caller-owned ledger failure must never turn a
            # valid model answer (or its original ProviderError) into a new
            # failure that invites the logical request to be replayed.
            return

    def _invoke(self, call: ModelCall, resolved) -> str:
        routed_call = ModelCall(
            model=resolved.upstream_model,
            messages=call.messages,
            system=call.system,
            temperature=call.temperature,
            max_tokens=call.max_tokens,
            reasoning_effort=call.reasoning_effort,
            reasoning_summary=call.reasoning_summary,
            client_requested_model=call.client_requested_model,
            request_id=call.request_id,
            allow_account_failover=call.allow_account_failover,
            allow_transport_retry=call.allow_transport_retry,
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
            try:
                call.transport_recoveries_out = list(
                    routed_call.transport_recoveries_out
                )
            except Exception:
                # A malformed provider out-param is telemetry, not a new model
                # outcome. Leave the caller-owned ledger untouched.
                pass
            if not isinstance(call.request_id, str) or not call.request_id.strip():
                call.request_id = routed_call.request_id
