from __future__ import annotations

import time
from typing import Any, Callable, Optional

from .. import failover, provider_health
from ..council.policy import CouncilConfig
from ..model_telemetry import record_model_attempt
from .. import usage_ledger
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
    """Run the selected model, then only the user's configured default."""

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
        resolved = resolve_model(model or registry.preferred_model())
        if resolved.is_unknown_external:
            return registry.default_fallback(model) or resolved
        if not resolved.is_chatgpt:
            try:
                dispatch.credentials_for(resolved.provider)
            except ProviderError:
                return registry.default_fallback(model) or resolved
        return resolved

    def call_model(self, call: ModelCall) -> str:
        requested = resolve_model(call.model or registry.preferred_model())
        fallback = registry.default_fallback(call.model or registry.preferred_model())
        resolved = self._route(call.model)
        substituted = (
            requested.provider.id != resolved.provider.id
            or requested.upstream_model != resolved.upstream_model
        )
        try:
            return self._attempt(call, resolved, fallback=substituted)
        except ProviderError as exc:
            self._note_failure(resolved, exc)
            if substituted or fallback is None or not exc.replay_safe:
                raise
        # Exactly one direct attempt. Do not route or discover another model
        # if the default is unconfigured, unhealthy, or itself fails.
        call.allow_account_failover = False
        call.allow_transport_retry = False
        try:
            return self._attempt(call, fallback, fallback=True)
        except ProviderError as exc:
            self._note_failure(fallback, exc)
            raise

    @staticmethod
    def _note_failure(resolved, error: ProviderError) -> None:
        if _is_quota_error(error.status_code, str(error)):
            _observe(failover.note_exhausted, resolved.public_model, reason=str(error))
        else:
            _observe(provider_health.note_failure, resolved.provider.id,
                     reason=str(error), status_code=error.status_code)

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

    def _attempt(self, call: ModelCall, resolved, *, fallback: bool) -> str:
        """Invoke one resolved model and retain its exact routing identity."""
        started_at = time.time()
        try:
            result = self._invoke(call, resolved)
        except ProviderError as exc:
            status = getattr(exc, "status_code", None)
            outcome = (
                "quota_exhausted"
                if _is_quota_error(status, str(exc))
                else "failed"
            )
            self._record_usage(
                call,
                resolved,
                outcome=outcome,
                fallback=fallback,
                started_at=started_at,
                status_code=status,
                error=str(exc),
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
        self._record_usage(
            call,
            resolved,
            outcome="succeeded",
            fallback=fallback,
            started_at=started_at,
        )
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
    def _record_usage(
        call: ModelCall,
        resolved,
        *,
        outcome: str,
        fallback: bool,
        started_at: float,
        status_code: int | None = None,
        error: str | None = None,
    ) -> None:
        """One usage-ledger row per council seat call, naming who paid."""
        try:
            account = call.account_out
            if not isinstance(account, dict):
                account = usage_ledger.provider_account(
                    resolved.provider.id,
                    getattr(resolved.provider, "label", None),
                )
            usage_ledger.record_usage(
                kind="council",
                endpoint="council",
                provider=resolved.provider.id,
                model=resolved.upstream_model,
                requested_model=call.client_requested_model or call.model,
                request_id=call.request_id,
                account=account,
                origin=call.origin,
                tokens=call.usage_out,
                outcome=outcome,
                status_code=status_code,
                error=error,
                started_at=started_at,
                fallback=fallback,
            )
        except Exception:
            # Observational only; never turns a model result into a failure.
            return

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
            origin=call.origin,
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
            call.account_out = routed_call.account_out
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
