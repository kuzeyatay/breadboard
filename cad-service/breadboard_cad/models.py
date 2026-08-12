"""Every structure that crosses a process boundary in the CAD service.

Two boundaries use these models: the loopback HTTP surface (Breadboard's Next.js
server talks to this service) and the executor/worker pipe (this service talks to
the process that runs generated code). Both are validated in both directions, so
a malformed payload is a typed refusal rather than an exception deep inside a
build.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["info", "warning", "error"]
ExportFormat = Literal["step", "stl", "glb", "3mf"]
#: Boundary-representation exchange formats OpenCascade can read back in. Named
#: here rather than in the engine so the HTTP surface can advertise them without
#: importing the kernel into the service process.
ImportFormat = Literal["step", "stp", "iges", "igs", "brep"]
IMPORT_FORMATS: tuple[str, ...] = ("step", "stp", "iges", "igs", "brep")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ValidationIssue(StrictModel):
    """One deterministic finding. Mirrors `CADValidationIssue` in TypeScript."""

    code: str
    severity: Severity
    message: str
    feature: str | None = None
    expected: Any | None = None
    actual: Any | None = None
    repair_hint: str | None = Field(default=None, alias="repairHint")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class BoundingBox(StrictModel):
    x: float
    y: float
    z: float
    xmin: float
    ymin: float
    zmin: float
    xmax: float
    ymax: float
    zmax: float


class SolidSummary(StrictModel):
    """Per-solid measurements, so a body can be checked on its own."""

    name: str
    volume: float
    surface_area: float = Field(alias="surfaceArea")
    bounding_box: BoundingBox = Field(alias="boundingBox")
    valid: bool
    watertight: bool
    face_count: int = Field(alias="faceCount")
    edge_count: int = Field(alias="edgeCount")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class TessellationSummary(StrictModel):
    linear_tolerance: float = Field(alias="linearTolerance")
    angular_tolerance: float = Field(alias="angularTolerance")
    vertex_count: int = Field(alias="vertexCount")
    triangle_count: int = Field(alias="triangleCount")
    degenerate_triangle_count: int = Field(alias="degenerateTriangleCount")
    non_manifold_edge_count: int = Field(alias="nonManifoldEdgeCount")
    open_edge_count: int = Field(alias="openEdgeCount")
    has_non_finite_coordinates: bool = Field(alias="hasNonFiniteCoordinates")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ExecutionFailure(StrictModel):
    """Structured exception data. Never a terminal string for the agent to parse."""

    code: str
    message: str
    exception_type: str = Field(default="", alias="exceptionType")
    line: int = 0
    traceback_tail: str = Field(default="", alias="tracebackTail")
    violations: list[dict[str, Any]] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ExportRequest(StrictModel):
    format: ExportFormat
    filename: str
    linear_tolerance: float = Field(default=0.05, alias="linearTolerance", gt=0, le=5)
    angular_tolerance: float = Field(default=0.2, alias="angularTolerance", gt=0, le=2)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ExportedFile(StrictModel):
    format: str
    filename: str
    byte_size: int = Field(alias="byteSize")
    sha256: str
    linear_tolerance: float | None = Field(default=None, alias="linearTolerance")
    angular_tolerance: float | None = Field(default=None, alias="angularTolerance")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ValidationExpectations(StrictModel):
    """What the design spec promises, restated as machine-checkable numbers."""

    expected_solid_count: int | None = Field(default=None, alias="expectedSolidCount", ge=1, le=64)
    bounding_box: dict[str, float] | None = Field(default=None, alias="boundingBox")
    bounding_box_tolerance: float = Field(default=0.6, alias="boundingBoxTolerance", ge=0, le=50)
    minimum_wall_thickness: float | None = Field(
        default=None, alias="minimumWallThickness", ge=0, le=100
    )
    minimum_feature_size: float = Field(default=0.8, alias="minimumFeatureSize", ge=0, le=50)
    hole_diameters: list[float] = Field(default_factory=list, alias="holeDiameters")
    clearances: list[float] = Field(default_factory=list)
    printer_bed: dict[str, float] | None = Field(default=None, alias="printerBed")
    units: Literal["mm", "inch"] = "mm"

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class BuildRequest(StrictModel):
    """One execution: source, parameters, exports and what to check."""

    source: str
    entrypoint: str = "build_model"
    parameters: dict[str, Any] = Field(default_factory=dict)
    timeout_ms: int = Field(default=30_000, alias="timeoutMs", ge=1_000, le=300_000)
    exports: list[ExportRequest] = Field(default_factory=list)
    expectations: ValidationExpectations = Field(default_factory=ValidationExpectations)
    linear_tolerance: float = Field(default=0.05, alias="linearTolerance", gt=0, le=5)
    angular_tolerance: float = Field(default=0.2, alias="angularTolerance", gt=0, le=2)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ConvertRequest(StrictModel):
    """One import: a CAD exchange file in, a mesh and its measurements out.

    Distinct from `BuildRequest` because there is no program and therefore
    nothing for the source guard to admit — the untrusted thing here is the file
    itself, which is why it is still read inside the sandboxed worker.

    The bytes travel inline rather than by path. The service and its caller are
    always on the same machine, but a path in a request is a filesystem read
    primitive, and the shared secret is the only thing standing in front of it.
    """

    format: ImportFormat
    content_base64: str = Field(alias="contentBase64")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", ge=1_000, le=600_000)
    exports: list[ExportRequest] = Field(default_factory=list)
    linear_tolerance: float = Field(default=0.05, alias="linearTolerance", gt=0, le=5)
    angular_tolerance: float = Field(default=0.2, alias="angularTolerance", gt=0, le=2)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class BuildResult(StrictModel):
    ok: bool
    failure: ExecutionFailure | None = None
    solids: list[SolidSummary] = Field(default_factory=list)
    solid_count: int = Field(default=0, alias="solidCount")
    volume: float = 0.0
    surface_area: float = Field(default=0.0, alias="surfaceArea")
    bounding_box: BoundingBox | None = Field(default=None, alias="boundingBox")
    tessellation: TessellationSummary | None = None
    exports: list[ExportedFile] = Field(default_factory=list)
    issues: list[ValidationIssue] = Field(default_factory=list)
    #: The values the program actually built with — its own DEFAULT_PARAMS plus
    #: the supplied overrides. The design specification is reconciled from this,
    #: so a rewritten program's defaults are recorded rather than assumed.
    effective_parameters: dict[str, Any] = Field(
        default_factory=dict, alias="effectiveParameters"
    )
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = Field(default=0, alias="durationMs")
    engine: str = "cadquery"
    engine_version: str = Field(default="", alias="engineVersion")
    kernel_version: str = Field(default="", alias="kernelVersion")
    python_version: str = Field(default="", alias="pythonVersion")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class HealthResponse(StrictModel):
    status: Literal["ok", "degraded"]
    service_version: str = Field(alias="serviceVersion")
    python_version: str = Field(alias="pythonVersion")
    cadquery_version: str = Field(alias="cadqueryVersion")
    ocp_version: str = Field(alias="ocpVersion")
    export_formats: list[str] = Field(alias="exportFormats")
    #: Exchange formats the kernel can read back in. Empty when degraded.
    import_formats: list[str] = Field(default_factory=list, alias="importFormats")
    engines: list[str]
    detail: str = ""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)
