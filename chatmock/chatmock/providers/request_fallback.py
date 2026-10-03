"""One request, its selected model, and at most one configured-default attempt."""

from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable
from uuid import uuid4

from flask import Response, make_response

from .registry import default_fallback


@dataclass(frozen=True)
class RequestAttempt:
    request_id: str
    requested_model: str | None
    fallback: bool = False


current_attempt: ContextVar[RequestAttempt | None] = ContextVar("model_request_attempt", default=None)


def rejected_response(response: Any, *, replay_safe: bool = True) -> Response:
    """Mark an upstream rejection; local validation and partial streams cannot retry."""
    response = make_response(response)
    response._chatmock_replay_safe = replay_safe
    return response


def _finish(response: Response) -> Response:
    if response.status_code >= 400:
        # OpenAI-compatible SDKs must not restart the selected -> default chain.
        response.headers["x-should-retry"] = "false"
    return response


def with_default_fallback(payload: dict, invoke: Callable[[dict], Any]) -> Response:
    # An editorial pass belongs to the model selected for its chat. Callers
    # that require that identity can opt out without changing other requests.
    payload = dict(payload)
    allow_fallback = payload.pop("allow_model_fallback", True)
    if not isinstance(allow_fallback, bool):
        return _finish(make_response({"error": {"message": "allow_model_fallback must be boolean"}}, 400))
    requested = payload.get("model")
    attempt = RequestAttempt(f"mreq_{uuid4().hex}", requested if isinstance(requested, str) else None)
    # Snapshot the configured default. Discovery and health state never select
    # an alternative provider, even if the default is already out of credits.
    fallback = default_fallback(requested) if allow_fallback else None
    token = current_attempt.set(attempt)
    try:
        response = make_response(invoke(deepcopy(payload)))
        if (
            fallback is None
            or response.status_code < 400
            or not getattr(response, "_chatmock_replay_safe", False)
        ):
            return _finish(response)
        response.close()
        retry_payload = deepcopy(payload)
        retry_payload["model"] = fallback.public_model
        current_attempt.set(RequestAttempt(attempt.request_id, attempt.requested_model, True))
        # Deliberately invoke once, without re-entering this fallback boundary.
        response = make_response(invoke(retry_payload))
        response.headers["X-ChatMock-Failover"] = "true"
        response.headers["X-ChatMock-Resolved-Model"] = fallback.public_model
        response.headers["X-ChatMock-Upstream-Model"] = fallback.upstream_model
        response.headers["X-ChatMock-Provider"] = fallback.provider.id
        response.headers["X-ChatMock-Request-Id"] = attempt.request_id
        if attempt.requested_model:
            response.headers["X-ChatMock-Requested-Model"] = attempt.requested_model
        return _finish(response)
    finally:
        current_attempt.reset(token)
