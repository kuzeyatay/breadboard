"""The CadQuery / OpenCascade engine.

This module is the only place in the service that imports CadQuery, and it is
imported only inside the worker process — the HTTP server never loads the
kernel, so a kernel crash cannot take the service down.

The engine's contract with generated source is deliberately narrow. A program
defines ``build_model(params)`` and returns either a workplane, a shape, an
assembly, or a mapping of names to those. Everything else — measuring, checking,
tessellating, exporting — happens here against OCCT, not against whatever the
program felt like returning.
"""

from __future__ import annotations

import hashlib
import math
import os
import sys
from collections import Counter
from typing import Any

import cadquery as cq
from cadquery.occ_impl.exporters.assembly import exportGLTF
from OCP.BRepCheck import BRepCheck_Analyzer, BRepCheck_Shell, BRepCheck_Status
from OCP.TopAbs import TopAbs_ShapeEnum
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

from .engine import EngineError, register_engine
from .models import (
    IMPORT_FORMATS,
    BoundingBox,
    ExportedFile,
    ExportRequest,
    SolidSummary,
    TessellationSummary,
)

#: Colour used for the interactive preview. Kept here (not in the renderer) so
#: the GLB carries it and every viewer shows the same part.
_PREVIEW_COLOR = (0.60, 0.72, 0.63, 1.0)


def _kernel_version() -> str:
    """OpenCascade's version, read from whichever binding exposes it."""
    try:  # OCP >= 7.7 exposes the OCCT version constants module.
        from OCP.Standard import Standard_Version  # type: ignore[attr-defined]

        return str(Standard_Version.Get_s())
    except Exception:
        pass
    try:
        import importlib.metadata as metadata

        # cadquery-ocp's version tracks the OCCT release it wraps (7.8.1.1 → 7.8.1).
        raw = metadata.version("cadquery-ocp")
        return ".".join(raw.split(".")[:3])
    except Exception:
        return "unknown"


def _cadquery_version() -> str:
    return str(getattr(cq, "__version__", "unknown"))


def _shells(shape: cq.Shape) -> list[Any]:
    found: list[Any] = []
    explorer = TopExp_Explorer(shape.wrapped, TopAbs_ShapeEnum.TopAbs_SHELL)
    while explorer.More():
        found.append(TopoDS.Shell_s(explorer.Current()))
        explorer.Next()
    return found


def _is_watertight(shape: cq.Shape) -> bool:
    """A solid is printable only if every one of its shells closes.

    OCCT's ``TopoDS_Shape::Closed()`` flag is advisory and is not set by most
    construction paths, so it cannot be used for this. Asking BRepCheck whether
    each shell is closed is the check that actually answers the question.
    """
    shells = _shells(shape)
    if not shells:
        return False
    return all(
        BRepCheck_Shell(shell).Closed() == BRepCheck_Status.BRepCheck_NoError for shell in shells
    )


def _bounding_box(shape: cq.Shape) -> BoundingBox:
    box = shape.BoundingBox()
    return BoundingBox(
        x=box.xlen,
        y=box.ylen,
        z=box.zlen,
        xmin=box.xmin,
        ymin=box.ymin,
        zmin=box.zmin,
        xmax=box.xmax,
        ymax=box.ymax,
        zmax=box.zmax,
    )


def _combined_bounding_box(boxes: list[BoundingBox]) -> BoundingBox:
    xmin = min(box.xmin for box in boxes)
    ymin = min(box.ymin for box in boxes)
    zmin = min(box.zmin for box in boxes)
    xmax = max(box.xmax for box in boxes)
    ymax = max(box.ymax for box in boxes)
    zmax = max(box.zmax for box in boxes)
    return BoundingBox(
        x=xmax - xmin,
        y=ymax - ymin,
        z=zmax - zmin,
        xmin=xmin,
        ymin=ymin,
        zmin=zmin,
        xmax=xmax,
        ymax=ymax,
        zmax=zmax,
    )


def _as_shapes(value: Any, label: str) -> list[tuple[str, cq.Shape]]:
    """Normalize whatever a program returned into named solids.

    Accepts a Workplane, a Shape, an Assembly, or a mapping/sequence of those,
    because a model that has just been told "return named solids" should not
    fail on the difference between ``{"body": wp}`` and ``wp``.
    """
    if value is None:
        return []
    if isinstance(value, cq.Workplane):
        solids = value.solids().vals()
        if solids:
            return [
                (label if len(solids) == 1 else f"{label}_{index + 1}", solid)
                for index, solid in enumerate(solids)
            ]
        found = value.val()
        return [(label, found)] if isinstance(found, cq.Shape) else []
    if isinstance(value, cq.Assembly):
        collected: list[tuple[str, cq.Shape]] = []
        for child in value.traverse():
            name, node = child
            if node.obj is None:
                continue
            collected.extend(_as_shapes(node.obj, str(name)))
        return collected
    if isinstance(value, cq.Shape):
        return [(label, value)]
    if isinstance(value, dict):
        collected = []
        for key, item in value.items():
            collected.extend(_as_shapes(item, str(key)))
        return collected
    if isinstance(value, (list, tuple)):
        collected = []
        for index, item in enumerate(value):
            collected.extend(_as_shapes(item, f"{label}_{index + 1}"))
        return collected
    raise EngineError(
        "unsupported_result",
        f"build_model returned {type(value).__name__}, which is not a solid, workplane, "
        "assembly, or a mapping of names to those.",
    )


class CadQueryModel:
    """One built model: named solids plus everything measurable about them."""

    def __init__(
        self,
        named: list[tuple[str, cq.Shape]],
        effective_parameters: dict[str, Any] | None = None,
    ) -> None:
        self._named = named
        #: What the program actually built with — its own DEFAULT_PARAMS with the
        #: supplied overrides applied. Reported back so the design specification
        #: records the values that produced this solid rather than the values
        #: someone assumed it used.
        self.effective_parameters: dict[str, Any] = effective_parameters or {}
        self._summaries: list[SolidSummary] = []
        for name, shape in named:
            valid = bool(BRepCheck_Analyzer(shape.wrapped).IsValid())
            try:
                volume = float(shape.Volume())
            except Exception:
                volume = 0.0
            try:
                area = float(shape.Area())
            except Exception:
                area = 0.0
            self._summaries.append(
                SolidSummary(
                    name=name,
                    volume=volume,
                    surfaceArea=area,
                    boundingBox=_bounding_box(shape),
                    valid=valid,
                    watertight=_is_watertight(shape),
                    faceCount=len(shape.Faces()),
                    edgeCount=len(shape.Edges()),
                )
            )

    @property
    def solids(self) -> list[SolidSummary]:
        return self._summaries

    @property
    def bounding_box(self) -> BoundingBox:
        return _combined_bounding_box([summary.bounding_box for summary in self._summaries])

    @property
    def volume(self) -> float:
        return sum(summary.volume for summary in self._summaries)

    @property
    def surface_area(self) -> float:
        return sum(summary.surface_area for summary in self._summaries)

    def _compound(self) -> cq.Shape:
        shapes = [shape for _, shape in self._named]
        return shapes[0] if len(shapes) == 1 else cq.Compound.makeCompound(shapes)

    def _assembly(self) -> cq.Assembly:
        assembly = cq.Assembly(name="model")
        color = cq.Color(*_PREVIEW_COLOR)
        for name, shape in self._named:
            assembly.add(shape, name=name, color=color)
        return assembly

    def tessellate(
        self, linear_tolerance: float, angular_tolerance: float
    ) -> TessellationSummary:
        """Mesh every solid and report what a slicer would object to.

        Triangles are welded by position before the edges are counted. OCCT
        tessellates each face independently, so two triangles that meet along a
        shared edge carry different vertex indices for the same point — index
        matching would report every edge in a perfectly closed part as open.
        """
        vertex_total = 0
        triangle_total = 0
        degenerate = 0
        non_manifold = 0
        open_edges = 0
        non_finite = False

        for _, shape in self._named:
            try:
                vertices, triangles = shape.tessellate(linear_tolerance, angular_tolerance)
            except Exception as error:  # pragma: no cover - kernel-dependent
                raise EngineError(
                    "tessellation_failed",
                    f"The solid could not be meshed at {linear_tolerance} mm: {error}",
                ) from error
            vertex_total += len(vertices)
            triangle_total += len(triangles)

            points = [(float(v.x), float(v.y), float(v.z)) for v in vertices]
            for point in points:
                if any(not math.isfinite(value) for value in point):
                    non_finite = True
                    break

            welded = [_weld_key(point) for point in points]
            edge_uses: Counter[tuple[tuple[int, int, int], tuple[int, int, int]]] = Counter()
            for triangle in triangles:
                a, b, c = triangle[0], triangle[1], triangle[2]
                ka, kb, kc = welded[a], welded[b], welded[c]
                if ka == kb or kb == kc or ka == kc:
                    degenerate += 1
                    continue
                if _triangle_area(points[a], points[b], points[c]) < 1e-12:
                    degenerate += 1
                    continue
                for edge in ((ka, kb), (kb, kc), (kc, ka)):
                    edge_uses[(min(edge), max(edge))] += 1
            for count in edge_uses.values():
                if count == 1:
                    open_edges += 1
                elif count > 2:
                    non_manifold += 1

        return TessellationSummary(
            linearTolerance=linear_tolerance,
            angularTolerance=angular_tolerance,
            vertexCount=vertex_total,
            triangleCount=triangle_total,
            degenerateTriangleCount=degenerate,
            nonManifoldEdgeCount=non_manifold,
            openEdgeCount=open_edges,
            hasNonFiniteCoordinates=non_finite,
        )

    def export(self, request: ExportRequest, directory: str) -> ExportedFile:
        target = os.path.join(directory, request.filename)
        shape = self._compound()
        try:
            if request.format == "step":
                cq.exporters.export(shape, target, exportType="STEP")
            elif request.format == "stl":
                cq.exporters.export(
                    shape,
                    target,
                    exportType="STL",
                    tolerance=request.linear_tolerance,
                    angularTolerance=request.angular_tolerance,
                )
            elif request.format == "3mf":
                cq.exporters.export(
                    shape,
                    target,
                    exportType="3MF",
                    tolerance=request.linear_tolerance,
                    angularTolerance=request.angular_tolerance,
                )
            elif request.format == "glb":
                exportGLTF(
                    self._assembly(),
                    target,
                    True,
                    request.linear_tolerance,
                    request.angular_tolerance,
                )
            else:  # pragma: no cover - the model rejects unknown formats first
                raise EngineError("unsupported_export", f"Unknown export format {request.format}.")
        except EngineError:
            raise
        except Exception as error:
            raise EngineError(
                "export_failed",
                f"The {request.format.upper()} export failed: {error}",
            ) from error

        if not os.path.isfile(target):
            raise EngineError(
                "export_missing", f"The {request.format.upper()} export produced no file."
            )
        payload = _read_file(target)
        if not payload:
            raise EngineError(
                "export_empty", f"The {request.format.upper()} export produced an empty file."
            )
        return ExportedFile(
            format=request.format,
            filename=request.filename,
            byteSize=len(payload),
            sha256=hashlib.sha256(payload).hexdigest(),
            linearTolerance=None if request.format == "step" else request.linear_tolerance,
            angularTolerance=None if request.format == "step" else request.angular_tolerance,
        )


def import_model(path: str, import_format: str) -> CadQueryModel:
    """Read a CAD exchange file into the same model every other path produces.

    A user's STEP file is not a program and never goes near the source guard or
    the sandboxed executor's admission control — but it is still untrusted input
    to a large C++ kernel, so it is read in the same short-lived worker process
    that a generated program would run in. A malformed file that crashes OCCT
    costs one request.

    What comes back is a `CadQueryModel`, so measuring, tessellating and
    exporting are the code that already exists rather than a second
    implementation for imported geometry.
    """
    fmt = import_format.lower()
    if fmt not in IMPORT_FORMATS:
        raise EngineError("unsupported_import", f"Cannot import .{import_format} files.")
    if not os.path.isfile(path):
        raise EngineError("import_missing", "The file to import is not in the workspace.")

    try:
        if fmt in ("step", "stp"):
            imported = cq.importers.importStep(path)
        elif fmt == "brep":
            imported = cq.importers.importBrep(path)
        else:
            imported = _read_iges(path)
    except EngineError:
        raise
    except Exception as error:
        raise EngineError(
            "import_failed",
            f"The {fmt.upper()} file could not be read: {error}",
        ) from error

    # Each importer hands back something different — a workplane, a shape, a
    # compound of surfaces — so the result goes through the same normaliser a
    # generated program's return value does. An exchange file names its contents
    # inconsistently or not at all, hence the numbered fallback label.
    named = [
        (name, shape)
        for name, shape in _as_shapes(imported, "body")
        if isinstance(shape, cq.Shape) and not shape.isNull()
    ]
    if not named:
        raise EngineError(
            "import_empty",
            f"The {fmt.upper()} file contains no geometry that OpenCascade could read.",
        )
    return CadQueryModel(named)


def _read_iges(path: str) -> cq.Shape:
    """IGES, which CadQuery has no importer for, straight off the OCCT reader."""
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.IGESControl import IGESControl_Reader

    reader = IGESControl_Reader()
    if reader.ReadFile(path) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise EngineError("import_failed", "The IGES file could not be parsed.")
    reader.TransferRoots()
    return cq.Shape.cast(reader.OneShape())


def _read_file(path: str) -> bytes:
    handle = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0))
    try:
        chunks: list[bytes] = []
        while True:
            chunk = os.read(handle, 1 << 20)
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(handle)


#: Mesh vertices are welded on a 0.1 µm lattice — far finer than any printable
#: feature, coarse enough to absorb the last-bit differences between two faces'
#: discretization of the same edge.
_WELD_SCALE = 10_000.0


def _weld_key(point: tuple[float, float, float]) -> tuple[int, int, int]:
    return (
        int(round(point[0] * _WELD_SCALE)),
        int(round(point[1] * _WELD_SCALE)),
        int(round(point[2] * _WELD_SCALE)),
    )


def _triangle_area(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
    c: tuple[float, float, float],
) -> float:
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    cx = uy * vz - uz * vy
    cy = uz * vx - ux * vz
    cz = ux * vy - uy * vx
    return 0.5 * math.sqrt(cx * cx + cy * cy + cz * cz)


class CadQueryEngine:
    name = "cadquery"
    export_formats = ("step", "stl", "glb", "3mf")

    def __init__(self) -> None:
        self.version = _cadquery_version()
        self.kernel_version = _kernel_version()

    def build(self, source: str, entrypoint: str, parameters: dict[str, Any]) -> CadQueryModel:
        namespace: dict[str, Any] = {"__name__": "breadboard_cad_model", "__builtins__": _builtins()}
        try:
            compiled = compile(source, "<cad-model>", "exec")
        except SyntaxError as error:
            raise EngineError(
                "syntax_error",
                f"{error.msg} (line {error.lineno}, column {error.offset}).",
                error.lineno or 0,
            ) from error
        # The program has already passed AST admission control and runs in its
        # own short-lived process; this is the one place `exec` is permitted and
        # it is never the Breadboard application process.
        exec(compiled, namespace)  # noqa: S102

        builder = namespace.get(entrypoint)
        if not callable(builder):
            raise EngineError(
                "missing_entrypoint",
                f"The CAD source defines no callable `{entrypoint}`.",
            )
        result = builder(dict(parameters))
        named = _as_shapes(result, "body")
        if not named:
            raise EngineError(
                "empty_result",
                "build_model returned no solid. A part must return at least one closed body.",
            )
        return CadQueryModel(named, _effective_parameters(namespace, parameters))


def _guarded_import(
    name: str,
    globals_: dict[str, Any] | None = None,
    locals_: dict[str, Any] | None = None,
    fromlist: tuple[str, ...] = (),
    level: int = 0,
) -> Any:
    """The only importer a generated program sees.

    The AST guard already refuses a disallowed import statically. Enforcing the
    same allowlist here means the guard is a fast refusal rather than the only
    thing standing between a program and the standard library — a rule the guard
    missed still cannot import its way out at runtime.
    """
    from .guard import ALLOWED_IMPORTS

    if level:
        raise ImportError("Relative imports are not available in CAD source.")
    root = name.split(".", 1)[0]
    if root not in ALLOWED_IMPORTS:
        raise ImportError(
            f"`{name}` is not in the CAD import allowlist "
            f"({', '.join(sorted(ALLOWED_IMPORTS))})."
        )
    import builtins as _real

    return _real.__import__(name, globals_, locals_, fromlist, level)


def _effective_parameters(
    namespace: dict[str, Any], supplied: dict[str, Any]
) -> dict[str, Any]:
    """The values the program built with.

    Generated programs follow one convention: a module-level ``DEFAULT_PARAMS``
    dict, merged with the supplied overrides inside ``build_model``. Reading it
    back means a rewritten program's own defaults are what the design records,
    instead of whatever the previous revision happened to use.
    """
    merged: dict[str, Any] = {}
    defaults = namespace.get("DEFAULT_PARAMS")
    if isinstance(defaults, dict):
        for key, value in defaults.items():
            if isinstance(key, str) and isinstance(value, (int, float, bool, str)):
                merged[key] = value
    for key, value in supplied.items():
        if isinstance(key, str) and isinstance(value, (int, float, bool, str)):
            merged[key] = value
    return merged


def _builtins() -> dict[str, Any]:
    """The builtins a part description may use.

    An allowlist rather than the real ``builtins`` module: the AST guard already
    refuses the dangerous names, and keeping them out of the namespace as well
    means a program that slipped past a guard rule still cannot reach them.
    """
    import builtins as _real

    permitted = (
        "abs bool dict divmod enumerate filter float format frozenset int len list map max min "
        "next object print range repr reversed round set slice sorted str sum tuple type zip "
        "isinstance issubclass hasattr any all callable id hash chr ord bin hex oct pow complex "
        "bytes bytearray property staticmethod classmethod super iter Exception ValueError "
        "TypeError KeyError IndexError ZeroDivisionError ArithmeticError RuntimeError "
        "NotImplementedError AttributeError StopIteration True False None"
    ).split()
    namespace = {name: getattr(_real, name) for name in permitted if hasattr(_real, name)}
    namespace["__build_class__"] = _real.__build_class__
    namespace["__import__"] = _guarded_import
    namespace["__name__"] = "breadboard_cad_model"
    return namespace


def python_version() -> str:
    return sys.version.split()[0]


register_engine(CadQueryEngine())
