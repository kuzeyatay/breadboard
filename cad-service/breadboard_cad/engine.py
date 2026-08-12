"""The CAD engine seam.

Everything above this module works in terms of *named solids* and *measurements*
— never in terms of CadQuery objects. Adding build123d (or any other kernel that
can produce OCCT shapes) means implementing this protocol and registering it;
nothing in the executor, the validator, the tool contracts, or the artifact
renderer has to change.
"""

from __future__ import annotations

from typing import Any, Protocol

from .models import BoundingBox, ExportedFile, ExportRequest, SolidSummary, TessellationSummary


class BuiltModel(Protocol):
    """What an engine hands back after running one program."""

    @property
    def solids(self) -> list[SolidSummary]: ...

    @property
    def bounding_box(self) -> BoundingBox: ...

    @property
    def volume(self) -> float: ...

    @property
    def surface_area(self) -> float: ...

    @property
    def effective_parameters(self) -> dict[str, Any]: ...

    def tessellate(
        self, linear_tolerance: float, angular_tolerance: float
    ) -> TessellationSummary: ...

    def export(self, request: ExportRequest, directory: str) -> ExportedFile: ...


class CadEngine(Protocol):
    """One parametric CAD backend."""

    name: str
    version: str
    kernel_version: str
    export_formats: tuple[str, ...]

    def build(self, source: str, entrypoint: str, parameters: dict[str, Any]) -> BuiltModel:
        """Run one program and return its solids. Raises `EngineError` on failure."""
        ...


class EngineError(Exception):
    """A build failure the agent can act on."""

    def __init__(self, code: str, message: str, line: int = 0) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.line = line


_REGISTRY: dict[str, "CadEngine"] = {}


def register_engine(engine: "CadEngine") -> None:
    _REGISTRY[engine.name] = engine


def get_engine(name: str = "cadquery") -> "CadEngine":
    if name not in _REGISTRY:
        raise EngineError("engine_unavailable", f"No CAD engine named {name!r} is registered.")
    return _REGISTRY[name]


def registered_engines() -> list[str]:
    return sorted(_REGISTRY)
