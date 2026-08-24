from __future__ import annotations

from typing import Any, Dict, Optional


class LearnStrictRouteError(ValueError):
    pass


def consume_learn_strict_route(payload: Dict[str, Any]) -> Optional[bool]:
    """Remove and strictly parse Learn's internal route-policy aliases.

    ``None`` means absent; a boolean means the field was explicitly present.
    Keeping presence distinct from ``False`` lets unsupported transports reject
    the private namespace instead of forwarding even a disabled-looking flag.
    """
    camel_present = "learnStrictRoute" in payload
    snake_present = "learn_strict_route" in payload
    camel = payload.pop("learnStrictRoute", None)
    snake = payload.pop("learn_strict_route", None)
    if camel_present and snake_present and (
        type(camel) is not type(snake) or camel != snake
    ):
        raise LearnStrictRouteError("Conflicting Learn strict-route aliases.")
    if not camel_present and not snake_present:
        return None
    value = camel if camel_present else snake
    if not isinstance(value, bool):
        raise LearnStrictRouteError("Learn strict-route flag must be boolean.")
    return value
