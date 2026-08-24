from __future__ import annotations

"""Single entry point for serving a request from a non-ChatGPT provider.

Both callers land here: the ``/v1/chat/completions`` route (when the requested
model resolves to an external provider) and the council's ``ProviderRouter``.
Keeping one dispatcher means credential resolution, error shaping and streaming
behave identically whether a request is council-mediated or a passthrough.
"""

import json
from dataclasses import dataclass
from typing import Any, Dict, List
from uuid import uuid4

from flask import Response, jsonify, make_response

from .. import failover
from ..http import build_cors_headers
from ..model_identity import with_resolved_model_identity
from ..model_telemetry import record_model_attempt
from . import anthropic, claude_code, openai_compatible, transport
from .catalog import KIND_ANTHROPIC, KIND_CHATGPT_OAUTH, KIND_OPENAI_COMPATIBLE, ProviderSpec, provider_spec
from .registry import (
    ResolvedModel,
    healthy_fallbacks,
    reasoning_efforts_for,
    resolve_model,
)
from .store import ResolvedCredentials, resolve_credentials
from .types import ModelCall, ProviderError

# How many stand-ins to try before reporting the original refusal. The council
# walks the whole list, but this path has a client waiting on the socket: a long
# chain of full model calls would replace a clear "out of quota" with a minute
# of silence.
_MAX_FALLBACK_ATTEMPTS = 3

# Antigravity sometimes returns a bare RESOURCE_EXHAUSTED for one request while
# the same model and sibling Gemini aliases remain healthy. Treating that as an
# account-wide outage made every Google entry immediately fall back to Claude.
# Bench only the exact alias, and only briefly when the proxy gives no reset.
_GOOGLE_MODEL_RECHECK_SECONDS = 15


def _is_quota_error(status_code: int | None, message: str) -> bool:
    try:
        return failover.is_quota_error(status_code, message)
    except Exception:
        # Classification is control-plane bookkeeping. The provider's exact
        # response remains authoritative if cooldown state is unavailable.
        return False


def _client_for(spec: ProviderSpec):
    if spec.kind == KIND_ANTHROPIC:
        return anthropic
    if spec.kind == KIND_OPENAI_COMPATIBLE:
        return openai_compatible
    raise ProviderError(f"{spec.id} cannot serve requests through this path")


def _client_for_model(spec: ProviderSpec, upstream_model: str):
    """Choose the data path whose credential owner actually serves the model."""
    if spec.id == "cliproxy" and claude_code.is_claude_model(upstream_model):
        return claude_code
    return _client_for(spec)


def credentials_for(spec: ProviderSpec) -> ResolvedCredentials:
    credentials = resolve_credentials(spec)
    if not credentials.usable:
        raise ProviderError(f"{spec.label} is not available: {credentials.reason}")
    return credentials


def strict_single_attempt_supported(resolved: ResolvedModel) -> bool:
    # The Claude Code CLI owns its own agent/session lifecycle. ChatMock cannot
    # prove that one CLI invocation maps to exactly one upstream provider POST,
    # so it is not an admissible target for Learn's one-call contract.
    return not (
        resolved.provider.id == "cliproxy"
        and claude_code.is_claude_model(resolved.upstream_model)
    )


def _error_response(message: str, status: int) -> Response:
    resp = make_response(jsonify({"error": {"message": message}}), status)
    for key, value in build_cors_headers().items():
        resp.headers.setdefault(key, value)
    return resp


def _stream_response(iterator, status: int = 200) -> Response:
    resp = Response(
        iterator,
        status=status,
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
    for key, value in build_cors_headers().items():
        resp.headers.setdefault(key, value)
    return resp


def _with_supported_reasoning(
    payload: Dict[str, Any],
    resolved: ResolvedModel,
) -> Dict[str, Any]:
    """Settle the request's reasoning effort for the target model.

    Every provider client here reads `reasoning_effort`, so a Responses-shaped
    `reasoning: {"effort": ...}` is promoted to it first — otherwise a caller
    that speaks Responses (the learn pipeline, the council) would silently lose
    its chosen depth the moment the model resolved to a provider instead of
    ChatGPT.

    An effort the model does not honour is then dropped. Forwarding it anyway is
    not harmless: several OpenAI-compatible upstreams reject unknown or
    unsupported values outright, so asking for a mode the model lacks would turn
    into a failed request rather than a plain answer.
    """
    effort = payload.get("reasoning_effort")
    if not isinstance(effort, str) or not effort.strip():
        reasoning = payload.get("reasoning")
        nested = reasoning.get("effort") if isinstance(reasoning, dict) else None
        if not isinstance(nested, str) or not nested.strip():
            return payload
        effort = nested
        payload = {**payload, "reasoning_effort": effort.strip().lower()}

    supported = reasoning_efforts_for(resolved.public_model)
    if effort.strip().lower() in supported:
        return payload

    trimmed = dict(payload)
    trimmed.pop("reasoning_effort", None)
    return trimmed


@dataclass(frozen=True)
class _Exhausted:
    """A refusal that means "this model cannot answer right now".

    Distinct from an error response because it is not the client's answer: the
    request should be tried on a different model before anyone is told no.
    """

    message: str
    status: int
    seconds: int | None


def _exhaustion_details(
    response,
    spec: ProviderSpec,
    public_model: str,
) -> tuple[str, int | None]:
    """Read a failed response as ``(message, seconds until the model returns)``.

    CLIProxyAPI answers a spent subscription quota with a structured
    ``model_cooldown`` error carrying ``reset_seconds`` — the exact moment the
    model can serve again. Honouring it matters, because the generic cooldown is
    fifteen minutes: a Gemini free-tier window that reopens in fifty seconds
    would otherwise be treated as unavailable for the rest of the quarter hour.

    Its wording is replaced for the same reason ``transport.error_message``
    exists. "All credentials for model gemini-3.6-flash-high are cooling down
    via provider antigravity" is three internal nouns and no instruction; the
    reader sees it as the assistant's answer.
    """
    try:
        body = response.json()
    except Exception:
        body = None

    error = body.get("error") if isinstance(body, dict) else None
    seconds: int | None = None
    if isinstance(error, dict):
        for key in ("reset_seconds", "retry_after_seconds", "retry_after"):
            value = error.get(key)
            # `bool` is an `int`; a `retry_after: true` must not become 1 second.
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            if 0 < value <= failover.MAX_COOLDOWN_SECONDS:
                seconds = int(value)
                break

        if error.get("code") == "model_cooldown":
            wait = f"about {seconds} seconds" if seconds else "a short while"
            return (
                f"{public_model} has used up its quota for now. "
                f"It should answer again in {wait}."
            ), seconds

    return transport.error_message(response, spec.id), seconds


def _stand_ins(exhausted: str) -> List[ResolvedModel]:
    """Models that can answer in place of an exhausted one, best first.

    ChatGPT ids are skipped even though ``healthy_fallbacks`` offers them first:
    serving one needs the OAuth upstream in ``routes_openai``, a layer above this
    dispatcher. The route only lands here for external models, so the honest
    substitutes are the other external ones. Providers without usable
    credentials are dropped here rather than attempted, so the small attempt
    budget is not spent on models that were never going to answer.
    """
    exhausted_model = resolve_model(exhausted)
    out: List[ResolvedModel] = []
    try:
        candidates = list(healthy_fallbacks(exhausted))
    except Exception:
        return []
    for candidate in candidates:
        substitute = resolve_model(candidate)
        if substitute.is_chatgpt or substitute.is_unknown_external:
            continue
        try:
            credentials_for(substitute.provider)
        except ProviderError:
            continue
        out.append(substitute)

    # A transient Antigravity refusal can be isolated to one Gemini alias. Try
    # exactly one sibling before leaving Google; direct live probes have shown
    # those siblings serving while the selected alias returns a bare 429. The
    # one-sibling cap keeps a genuine account-wide outage from walking the
    # entire Gemini catalog before reaching Claude.
    out.sort(key=lambda candidate: _stand_in_priority(exhausted_model, candidate))
    selected: List[ResolvedModel] = []
    tried_same_family = False
    for candidate in out:
        same_family = (
            candidate.provider.id == exhausted_model.provider.id
            and _subscription_family(candidate) == _subscription_family(exhausted_model)
        )
        if same_family:
            if tried_same_family:
                continue
            tried_same_family = True
        selected.append(candidate)
        if len(selected) >= _MAX_FALLBACK_ATTEMPTS:
            break
    return selected


def _subscription_family(model: ResolvedModel) -> str:
    if model.provider.id != "cliproxy":
        return model.provider.id
    upstream = model.upstream_model.lower()
    if upstream.startswith(("gemini", "gemma")):
        return "google"
    if upstream.startswith("kimi"):
        return "kimi"
    if claude_code.is_claude_model(upstream):
        return "claude"
    return upstream.split("-", 1)[0]


def _stand_in_priority(
    exhausted: ResolvedModel,
    candidate: ResolvedModel,
) -> tuple[int, str]:
    if (
        candidate.provider.id == exhausted.provider.id
        and _subscription_family(candidate) == _subscription_family(exhausted)
    ):
        return (0, candidate.public_model)
    if (
        candidate.provider.id == "cliproxy"
        and claude_code.is_claude_model(candidate.upstream_model)
    ):
        return (1, candidate.public_model)
    if candidate.provider.id != exhausted.provider.id:
        return (2, candidate.public_model)
    return (3, candidate.public_model)


def _record_exhaustion(resolved: ResolvedModel, outcome: _Exhausted) -> None:
    """Cool the exact failed model for the reset window the upstream reports.

    A bare Google ``RESOURCE_EXHAUSTED`` is deliberately *not* propagated to
    sibling Gemini aliases. Antigravity has been observed returning it for one
    request while those siblings (and even the original alias moments later)
    answer normally. Family-wide cooldowns therefore manufacture an outage.
    """
    transient_google_refusal = (
        outcome.seconds is None
        and resolved.provider.id == "cliproxy"
        and _subscription_family(resolved) == "google"
    )
    cooldown_seconds = (
        _GOOGLE_MODEL_RECHECK_SECONDS
        if transient_google_refusal
        else outcome.seconds
    )
    try:
        failover.note_exhausted(
            resolved.public_model,
            reason=outcome.message,
            seconds=cooldown_seconds,
        )
    except Exception:
        # Cooldown state observes a terminal quota response. It cannot replace
        # that response or prevent a safe stand-in from being attempted.
        pass


def clear_recovered_model(resolved: ResolvedModel) -> None:
    """Drop the exact model's stale cooldown after it answers successfully."""
    try:
        failover.clear(resolved.public_model)
    except Exception:
        # Recovery bookkeeping cannot replace the provider's valid answer.
        pass


def chat_completion_response(
    resolved: ResolvedModel,
    payload: Dict[str, Any],
    *,
    verbose: bool = False,
    requested_model: str | None = None,
    request_id: str | None = None,
    endpoint: str = "chat.completions",
    strict_route: bool = False,
) -> Response:
    """Serve one ``/v1/chat/completions`` request from an external provider.

    A spent quota is not a failed call to report. The model cannot answer for
    the next minute, hour or week no matter how the client retries, so the
    refusal is recorded as a cooldown — which is how ``default`` and the
    dashboard learn to stop pointing at it — and the request is served from a
    healthy model instead.

    ``ProviderRouter`` already does this for council calls. Without it here, the
    same 429 reached every passthrough client verbatim, and a subscription model
    on a one-minute free-tier cooldown looked like a provider that had simply
    stopped responding.
    """
    request_id = request_id or f"mreq_{uuid4().hex}"
    requested_model = (
        requested_model
        if isinstance(requested_model, str)
        else payload.get("model") if isinstance(payload.get("model"), str) else None
    )
    if strict_route and not strict_single_attempt_supported(resolved):
        return _error_response(
            "The requested model cannot prove strict single-attempt routing.",
            409,
        )
    cooldown = failover.cooldown_for(resolved.public_model)
    if cooldown is not None:
        # Hermes pins the concrete model id for a session instead of sending
        # ChatMock's ``default`` sentinel. Without this guard, a cooldown was
        # visible in Usage but every new turn still retried the same exhausted
        # Gemini credential before falling back. Preserve the user's selection,
        # but route around a refusal we already know is still active.
        outcome: Response | _Exhausted = _Exhausted(
            message=cooldown.reason
            or f"{resolved.public_model} has used up its quota for now.",
            status=429,
            seconds=max(1, cooldown.remaining_seconds),
        )
    else:
        outcome = _attempt(
            resolved,
            payload,
            verbose=verbose,
            requested_model=requested_model,
            request_id=request_id,
            endpoint=endpoint,
            fallback=False,
            strict_route=strict_route,
        )
    if isinstance(outcome, Response):
        return outcome

    _record_exhaustion(resolved, outcome)

    if strict_route:
        # Learn's job-level route fence makes the requested provider/model the
        # whole logical call. A quota refusal is terminal for this call.
        return _error_response(outcome.message, outcome.status)

    for substitute in _stand_ins(resolved.public_model):
        if verbose:
            print(
                f"[Providers] {resolved.public_model} is out of quota; "
                f"trying {substitute.public_model}"
            )
        retried = _attempt(
            substitute,
            payload,
            verbose=verbose,
            requested_model=requested_model,
            request_id=request_id,
            endpoint=endpoint,
            fallback=True,
            strict_route=False,
        )
        if isinstance(retried, Response):
            # A failed stand-in is the last request whose acceptance state we
            # actually know. In particular, a 502 synthesized from an
            # ambiguous transport exception must stop the chain: trying another
            # model could duplicate a request the stand-in already accepted.
            # Return that exact failure instead of replacing it with the
            # original quota response or walking to a third model.
            return retried
        _record_exhaustion(substitute, retried)

    return _error_response(outcome.message, outcome.status)


def _attempt(
    resolved: ResolvedModel,
    payload: Dict[str, Any],
    *,
    verbose: bool = False,
    requested_model: str | None,
    request_id: str,
    endpoint: str,
    fallback: bool,
    strict_route: bool,
) -> "Response | _Exhausted":
    """One try against one model."""
    spec = resolved.provider
    try:
        client = _client_for_model(spec, resolved.upstream_model)
        credentials = credentials_for(spec)
    except ProviderError as exc:
        _record_attempt(
            resolved,
            requested_model=requested_model,
            request_id=request_id,
            endpoint=endpoint,
            outcome="failed",
            fallback=fallback,
            status_code=503,
            error=str(exc),
            failure_phase="prepare",
            partial_output=False,
            replay_safe=True,
        )
        return _annotate_response(
            _error_response(str(exc), 503),
            resolved,
            requested_model=requested_model,
            request_id=request_id,
            fallback=fallback,
        )

    stream = bool(payload.get("stream"))
    stream_options = payload.get("stream_options")
    include_usage = bool(
        isinstance(stream_options, dict) and stream_options.get("include_usage")
    )

    payload = _with_supported_reasoning(payload, resolved)
    payload = with_resolved_model_identity(
        payload,
        model=resolved.public_model,
        provider=spec.id,
    )

    if verbose:
        print(f"[Providers] routing {resolved.public_model} to {spec.id} ({spec.kind})")

    try:
        request_kwargs = {"stream": stream}
        if strict_route:
            request_kwargs["allow_preconnect_retry"] = False
        response = client.request_chat(
            credentials,
            payload,
            resolved.upstream_model,
            **request_kwargs,
        )
    except ProviderError as exc:
        # The transport gave up rather than returning a response. Some upstreams
        # report exhaustion this way, so read the text the same way the council
        # router does before calling it a plain transport failure.
        # Quota wording alone is not non-acceptance proof. A transport can fail
        # ambiguously after the POST was accepted and still mention quota in its
        # exception; only a provider-classified terminal rejection may enter the
        # stand-in chain.
        if (
            getattr(exc, "replay_safe", False)
            and _is_quota_error(None, str(exc))
        ):
            _record_attempt(
                resolved,
                requested_model=requested_model,
                request_id=request_id,
                endpoint=endpoint,
                outcome="quota_exhausted",
                fallback=fallback,
                status_code=502,
                error=str(exc),
                failure_phase=getattr(exc, "phase", None),
                partial_output=getattr(exc, "partial_output", False),
                replay_safe=getattr(exc, "replay_safe", False),
                error_code=getattr(exc, "code", None),
            )
            return _Exhausted(message=str(exc), status=502, seconds=None)
        _record_attempt(
            resolved,
            requested_model=requested_model,
            request_id=request_id,
            endpoint=endpoint,
            outcome="failed",
            fallback=fallback,
            status_code=502,
            error=str(exc),
            failure_phase=getattr(exc, "phase", None),
            partial_output=getattr(exc, "partial_output", False),
            replay_safe=getattr(exc, "replay_safe", False),
            error_code=getattr(exc, "code", None),
        )
        return _annotate_response(
            _error_response(str(exc), 502),
            resolved,
            requested_model=requested_model,
            request_id=request_id,
            fallback=fallback,
        )

    if response.status_code >= 400:
        status = response.status_code
        message, seconds = _exhaustion_details(response, spec, resolved.public_model)
        transport.close_quietly(response)
        if _is_quota_error(status, message):
            _record_attempt(
                resolved,
                requested_model=requested_model,
                request_id=request_id,
                endpoint=endpoint,
                outcome="quota_exhausted",
                fallback=fallback,
                status_code=status,
                error=message,
            )
            return _Exhausted(message=message, status=status, seconds=seconds)
        _record_attempt(
            resolved,
            requested_model=requested_model,
            request_id=request_id,
            endpoint=endpoint,
            outcome="failed",
            fallback=fallback,
            status_code=status,
            error=message,
        )
        return _annotate_response(
            _error_response(message, status),
            resolved,
            requested_model=requested_model,
            request_id=request_id,
            fallback=fallback,
        )

    clear_recovered_model(resolved)

    if stream:
        if spec.kind == KIND_ANTHROPIC:
            iterator = transport.guard_stream(
                spec.id,
                lambda: anthropic.translate_stream(
                    response,
                    public_model=resolved.public_model,
                    include_usage=include_usage,
                ),
            )
        else:
            iterator = transport.guard_stream(
                spec.id,
                lambda: openai_compatible.relay_stream(response),
            )
        _record_attempt(
            resolved,
            requested_model=requested_model,
            request_id=request_id,
            endpoint=endpoint,
            outcome="succeeded",
            fallback=fallback,
            status_code=response.status_code,
        )
        return _annotate_response(
            _stream_response(iterator, response.status_code),
            resolved,
            requested_model=requested_model,
            request_id=request_id,
            fallback=fallback,
        )

    try:
        body = response.json()
    except ValueError:
        transport.close_quietly(response)
        message = (
            f"{transport.provider_label(spec.id)} returned a response that could not be read."
        )
        _record_attempt(
            resolved,
            requested_model=requested_model,
            request_id=request_id,
            endpoint=endpoint,
            outcome="failed",
            fallback=fallback,
            status_code=502,
            error=message,
        )
        return _annotate_response(
            _error_response(message, 502),
            resolved,
            requested_model=requested_model,
            request_id=request_id,
            fallback=fallback,
        )
    finally:
        transport.close_quietly(response)

    if spec.kind == KIND_ANTHROPIC:
        try:
            body = anthropic.translate_response(body, public_model=resolved.public_model)
        except ProviderError as exc:
            _record_attempt(
                resolved,
                requested_model=requested_model,
                request_id=request_id,
                endpoint=endpoint,
                outcome="failed",
                fallback=fallback,
                status_code=502,
                error=str(exc),
            )
            return _annotate_response(
                _error_response(str(exc), 502),
                resolved,
                requested_model=requested_model,
                request_id=request_id,
                fallback=fallback,
            )
    elif isinstance(body, dict):
        # Echo the id the client asked for, matching the ChatGPT path.
        body["model"] = resolved.public_model

    _record_attempt(
        resolved,
        requested_model=requested_model,
        request_id=request_id,
        endpoint=endpoint,
        outcome="succeeded",
        fallback=fallback,
        status_code=200,
    )
    resp = make_response(jsonify(body), 200)
    for key, value in build_cors_headers().items():
        resp.headers.setdefault(key, value)
    return _annotate_response(
        resp,
        resolved,
        requested_model=requested_model,
        request_id=request_id,
        fallback=fallback,
    )


def _record_attempt(
    resolved: ResolvedModel,
    *,
    requested_model: str | None,
    request_id: str,
    endpoint: str,
    outcome: str,
    fallback: bool,
    status_code: int | None = None,
    error: str | None = None,
    failure_phase: str | None = None,
    partial_output: bool | None = None,
    replay_safe: bool | None = None,
    error_code: str | None = None,
) -> Dict[str, Any]:
    try:
        return record_model_attempt(
            request_id=request_id,
            endpoint=endpoint,
            requested_model=requested_model,
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
        )
    except Exception:
        # Attempt telemetry is observational; it cannot be allowed to turn an
        # already completed provider call into a client-visible failure.
        return {}


def _annotate_response(
    response: Response,
    resolved: ResolvedModel,
    *,
    requested_model: str | None,
    request_id: str,
    fallback: bool,
) -> Response:
    if requested_model:
        response.headers["X-ChatMock-Requested-Model"] = requested_model
    response.headers["X-ChatMock-Resolved-Model"] = resolved.public_model
    response.headers["X-ChatMock-Upstream-Model"] = resolved.upstream_model
    response.headers["X-ChatMock-Provider"] = resolved.provider.id
    response.headers["X-ChatMock-Failover"] = "true" if fallback else "false"
    response.headers["X-ChatMock-Request-Id"] = request_id
    return response


def call_model(call: ModelCall, resolved: ResolvedModel) -> str:
    """One non-streaming council call against an external provider."""
    spec = resolved.provider
    client = _client_for_model(spec, resolved.upstream_model)
    credentials = credentials_for(spec)
    return client.call_model(call, credentials, resolved.upstream_model)


def verify_provider(provider_id: str) -> Dict[str, Any]:
    """Check stored credentials and, when possible, list live model ids."""
    spec = provider_spec(provider_id)
    if spec is None:
        return {"ok": False, "error": "unknown provider"}
    if spec.kind == KIND_CHATGPT_OAUTH:
        return {"ok": False, "error": "ChatGPT is managed on the Account tab"}

    credentials = resolve_credentials(spec)
    if not credentials.usable:
        return {"ok": False, "error": credentials.reason or "not configured"}

    client = _client_for(spec)
    return client.verify(credentials)


def discover_models(provider_id: str) -> List[str]:
    result = verify_provider(provider_id)
    models = result.get("models") if isinstance(result, dict) else None
    return models if isinstance(models, list) else []


def json_error(message: str) -> str:
    return json.dumps({"error": {"message": message}}, ensure_ascii=False)
