"""Image optimizers: make an exported file smaller after it is drawn and converted.

`IMAGE_OPTIMIZERS` lists the ones people may pick; each is offered only when it can run (`ready`). Exports
choose one with `optimize`: False, True (`IMAGE_OPTIMIZER_DEFAULT`) or an id. `base.optimize` runs it with the
fail-safe: the file never grows, and an error or timeout leaves it as it was, with a warning.
"""

from __future__ import annotations

from django.conf import settings

from ..exceptions import InvalidExport
from .base import UNAVAILABLE, Job, Optimizer, OptimizerError, OptimizeResult, optimize
from .builtin import Builtin
from .custom import Custom
from .kraken import Kraken
from .tinypng import TinyPng

__all__ = [
    "OPTIMIZERS",
    "UNAVAILABLE",
    "Job",
    "OptimizeResult",
    "Optimizer",
    "OptimizerError",
    "available",
    "choose",
    "default_optimizer",
    "get_optimizer",
    "listed",
    "optimize",
]

OPTIMIZERS: dict[str, Optimizer] = {
    optimizer.id: optimizer for optimizer in (Builtin(), TinyPng(), Kraken(), Custom())
}
_OFF = {"", "false", "none", "off", "no", "0"}
_DEFAULT = {"true", "default", "yes", "1"}


def listed() -> list[str]:
    """The ids in `IMAGE_OPTIMIZERS`, known ones only, in order and without repeats."""
    names = (str(name).strip().lower() for name in settings.IMAGE_OPTIMIZERS)
    return [name for name in dict.fromkeys(names) if name in OPTIMIZERS]


def available() -> list[Optimizer]:
    """The optimizers people may pick: listed and ready."""
    return [OPTIMIZERS[name] for name in listed() if OPTIMIZERS[name].ready()]


def get_optimizer(name: str) -> Optimizer | None:
    return next((optimizer for optimizer in available() if optimizer.id == name), None)


def default_optimizer() -> Optimizer | None:
    """`IMAGE_OPTIMIZER_DEFAULT` when it is available (never another one in its place)."""
    return get_optimizer(str(settings.IMAGE_OPTIMIZER_DEFAULT).strip().lower())


def choose(optimize: bool | str | None) -> Optimizer | None:
    """The optimizer an export's `optimize` asks for: None for no optimizing, `UNAVAILABLE` for True on a
    server without one (the export then says so in a warning). An id this server doesn't offer is an error."""
    if optimize is None or optimize is False:
        return None
    name = "true" if optimize is True else str(optimize).strip().lower()
    if name in _OFF:
        return None
    if name in _DEFAULT:
        return default_optimizer() or UNAVAILABLE
    found = get_optimizer(name)
    if found is None:
        offered = ", ".join(optimizer.id for optimizer in available()) or "none"
        raise InvalidExport(
            "optimizer_unavailable",
            f"This server has no image optimizer {name!r} (it offers: {offered}).",
        )
    return found
