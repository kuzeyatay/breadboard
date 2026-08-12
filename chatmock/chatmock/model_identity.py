from __future__ import annotations

"""Resolve Breadboard's late-bound model identity markers.

Hermes calls ChatMock with ``model=default`` through its ``custom`` transport.
Those are useful routing aliases, but they are not the identity of the model
that ultimately answers.  ChatMock is the first layer that knows that identity
for certain, including the model chosen for a quota-failover attempt, so the
replacement deliberately happens immediately before dispatch.
"""

from typing import Any


RESOLVED_MODEL_PLACEHOLDER = "{{BREADBOARD_CHATMOCK_RESOLVED_MODEL}}"
RESOLVED_PROVIDER_PLACEHOLDER = "{{BREADBOARD_CHATMOCK_RESOLVED_PROVIDER}}"


def with_resolved_model_identity(
    value: Any,
    *,
    model: str,
    provider: str,
) -> Any:
    """Return ``value`` with identity markers replaced, without mutating it."""
    if isinstance(value, str):
        return value.replace(RESOLVED_MODEL_PLACEHOLDER, model).replace(
            RESOLVED_PROVIDER_PLACEHOLDER, provider
        )
    if isinstance(value, list):
        return [
            with_resolved_model_identity(item, model=model, provider=provider)
            for item in value
        ]
    if isinstance(value, dict):
        return {
            key: with_resolved_model_identity(item, model=model, provider=provider)
            for key, item in value.items()
        }
    return value
