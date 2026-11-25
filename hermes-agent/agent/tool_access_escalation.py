"""Ask before refusing a tool that is switched off for this turn.

A host (Breadboard) decides each turn which tools are on, from keyword rules
and mode switches, before the model has read the request. When those rules
miss, the model called a tool it could see and got "X is disabled for this
turn" with no way to ask for it.

A host registers one escalation handler. When a call hits a tool whose
``tool_access`` entry is False, the handler decides: switch it on now (it
mutates ``tool_access`` in place, the same dict the agent holds, so the rest
of the turn sees it) or refuse with a reason. With no handler registered the
behavior is exactly the old refusal.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# handler(tool_access, function_name, function_args, task_id) -> None when
# granted (tool_access[function_name] is now True), or a refusal message.
EscalationHandler = Callable[[dict, str, dict, str], Optional[str]]

_handler: Optional[EscalationHandler] = None


def register_escalation_handler(handler: Optional[EscalationHandler]) -> None:
    global _handler
    _handler = handler


def disabled_message(function_name: str) -> str:
    return f"{function_name} is disabled for this turn."


def escalate(
    tool_access: Optional[dict],
    function_name: str,
    function_args: Any,
    task_id: str,
) -> Optional[str]:
    """Return None when the tool may run, else a JSON error string."""
    if not isinstance(tool_access, dict) or tool_access.get(function_name) is not False:
        return None
    message = disabled_message(function_name)
    if _handler is not None:
        try:
            refusal = _handler(
                tool_access,
                function_name,
                function_args if isinstance(function_args, dict) else {},
                task_id or "",
            )
            if refusal is None and tool_access.get(function_name) is not False:
                return None
            if refusal:
                message = refusal
        except Exception as exc:  # noqa: BLE001 - escalation failure keeps the old refusal.
            logger.warning("tool access escalation failed for %s: %s", function_name, exc)
    return json.dumps({"error": message}, ensure_ascii=False)
