from __future__ import annotations

"""chatmock_ask: the single mandatory entrypoint between ChatMock's API layer
and the Council Runtime.

Every normal ChatMock request must flow:

    route -> chatmock_ask(input) -> CouncilRuntime.run(input)

Nothing may bypass CouncilRuntime for normal requests. The runtime itself
chooses the cheapest safe council mode, so "always council" never means
"always expensive".
"""

import threading
from typing import Optional

from .council.runtime import CouncilRuntime
from .council.types import CouncilInput, CouncilRun

_runtime_lock = threading.Lock()
_runtime: Optional[CouncilRuntime] = None


def get_council_runtime() -> CouncilRuntime:
    global _runtime
    with _runtime_lock:
        if _runtime is None:
            _runtime = CouncilRuntime()
        return _runtime


def set_council_runtime(runtime: Optional[CouncilRuntime]) -> None:
    """Inject a runtime (tests) or reset to lazy default (pass None)."""
    global _runtime
    with _runtime_lock:
        _runtime = runtime


def chatmock_ask(council_input: CouncilInput) -> CouncilRun:
    return get_council_runtime().run(council_input)
