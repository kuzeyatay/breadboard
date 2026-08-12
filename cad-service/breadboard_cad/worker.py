"""The child process that runs one generated CAD program.

Started as ``python -m breadboard_cad.worker <job.json> <result.json>``, both
paths inside a workdir the executor created for this one execution. The worker
never listens on a socket, never reads the parent's environment beyond the few
variables an interpreter needs, and writes only into that workdir.

Everything it can go wrong at is reported as structured data in the result file.
A crash of the kernel takes this process down and nothing else — the executor
turns the missing result into a typed failure.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from typing import Any

from .guard import check_source
from .models import BuildRequest, BuildResult, ConvertRequest, ExecutionFailure

#: The name an imported file is given inside the workspace. Never the name the
#: user's file had: that is a string from a browser, and this one is a path.
IMPORT_FILENAME = "import.dat"


def _failure(code: str, message: str, **extra: Any) -> BuildResult:
    return BuildResult(ok=False, failure=ExecutionFailure(code=code, message=message, **extra))


def _last_model_line(error: BaseException) -> int:
    """The line inside the generated program, ignoring our own frames."""
    line = 0
    for frame in traceback.extract_tb(error.__traceback__):
        if frame.filename == "<cad-model>":
            line = frame.lineno or line
    return line


def _traceback_tail(error: BaseException, limit: int = 12) -> str:
    frames = traceback.format_exception(type(error), error, error.__traceback__, limit=limit)
    return "".join(frames)[-4_000:]


def run_job(request: BuildRequest, workdir: str) -> BuildResult:
    started = time.monotonic()

    # The guard already ran in the service process. Running it again here means
    # a job file that was tampered with between the two is still refused.
    admission = check_source(request.source, request.entrypoint)
    if not admission.ok:
        return _failure(
            "forbidden_source",
            "The CAD source was refused by static admission control.",
            violations=[violation.as_dict() for violation in admission.violations],
        )

    # Importing the kernel is deferred until a job is actually admitted, so a
    # refused program costs nothing and an import failure is reportable.
    try:
        from .cadquery_engine import python_version
        from .engine import EngineError, get_engine
    except Exception as error:  # pragma: no cover - environment failure
        return _failure(
            "engine_unavailable",
            f"The CAD engine could not be loaded: {error}",
            exceptionType=type(error).__name__,
        )

    try:
        engine = get_engine("cadquery")
    except Exception as error:  # pragma: no cover - registry failure
        return _failure("engine_unavailable", str(error), exceptionType=type(error).__name__)

    # Field names, not aliases: `model_copy(update=…)` bypasses validation and
    # writes attributes directly, so an alias here would silently land nowhere.
    versions = {
        "engine": engine.name,
        "engine_version": engine.version,
        "kernel_version": engine.kernel_version,
        "python_version": python_version(),
    }

    try:
        model = engine.build(request.source, request.entrypoint, request.parameters)
    except EngineError as error:
        return _failure(
            error.code,
            error.message,
            exceptionType="EngineError",
            line=error.line,
        ).model_copy(update=versions)
    except RecursionError as error:
        return _failure(
            "recursion_error",
            "The CAD program recursed without terminating.",
            exceptionType=type(error).__name__,
            line=_last_model_line(error),
        ).model_copy(update=versions)
    except MemoryError as error:
        return _failure(
            "out_of_memory",
            "The CAD program exhausted memory before producing a solid.",
            exceptionType=type(error).__name__,
        ).model_copy(update=versions)
    except BaseException as error:  # noqa: BLE001 - every failure must be reportable
        return _failure(
            "execution_error",
            f"{type(error).__name__}: {error}",
            exceptionType=type(error).__name__,
            line=_last_model_line(error),
            tracebackTail=_traceback_tail(error),
        ).model_copy(update=versions)

    try:
        tessellation = model.tessellate(request.linear_tolerance, request.angular_tolerance)
    except EngineError as error:
        return _failure(error.code, error.message, exceptionType="EngineError").model_copy(
            update=versions
        )

    exports = []
    for export_request in request.exports:
        try:
            exports.append(model.export(export_request, workdir))
        except EngineError as error:
            return _failure(
                error.code,
                error.message,
                exceptionType="EngineError",
            ).model_copy(update=versions)

    from .validation import validate_model

    issues = validate_model(
        model.solids,
        model.bounding_box,
        tessellation,
        request.expectations,
        [export.format for export in exports],
    )

    return BuildResult(
        ok=True,
        solids=model.solids,
        solidCount=len(model.solids),
        volume=model.volume,
        surfaceArea=model.surface_area,
        boundingBox=model.bounding_box,
        tessellation=tessellation,
        exports=exports,
        issues=issues,
        effectiveParameters=getattr(model, "effective_parameters", {}),
        durationMs=int((time.monotonic() - started) * 1000),
        **versions,
    )


def run_convert(request: ConvertRequest, workdir: str) -> BuildResult:
    """Tessellate one imported CAD exchange file.

    The same shape as `run_job` minus the program: no source, no admission
    control, no parameters. What it produces is a mesh the browser can draw plus
    the measurements that make an imported part as informative as a built one.
    """
    started = time.monotonic()

    try:
        from .cadquery_engine import python_version
        from .engine import EngineError
    except Exception as error:  # pragma: no cover - environment failure
        return _failure(
            "engine_unavailable",
            f"The CAD engine could not be loaded: {error}",
            exceptionType=type(error).__name__,
        )

    try:
        from .cadquery_engine import CadQueryEngine, import_model
    except Exception as error:  # pragma: no cover - environment failure
        return _failure("engine_unavailable", str(error), exceptionType=type(error).__name__)

    engine = CadQueryEngine()
    versions = {
        "engine": engine.name,
        "engine_version": engine.version,
        "kernel_version": engine.kernel_version,
        "python_version": python_version(),
    }

    try:
        model = import_model(os.path.join(workdir, IMPORT_FILENAME), request.format)
    except EngineError as error:
        return _failure(error.code, error.message, exceptionType="EngineError").model_copy(
            update=versions
        )
    except MemoryError as error:
        return _failure(
            "out_of_memory",
            "The CAD file exhausted memory before it could be read.",
            exceptionType=type(error).__name__,
        ).model_copy(update=versions)
    except BaseException as error:  # noqa: BLE001 - every failure must be reportable
        return _failure(
            "import_failed",
            f"{type(error).__name__}: {error}",
            exceptionType=type(error).__name__,
            tracebackTail=_traceback_tail(error),
        ).model_copy(update=versions)

    try:
        tessellation = model.tessellate(request.linear_tolerance, request.angular_tolerance)
    except EngineError as error:
        return _failure(error.code, error.message, exceptionType="EngineError").model_copy(
            update=versions
        )

    exports = []
    for export_request in request.exports:
        try:
            exports.append(model.export(export_request, workdir))
        except EngineError as error:
            return _failure(error.code, error.message, exceptionType="EngineError").model_copy(
                update=versions
            )

    return BuildResult(
        ok=True,
        solids=model.solids,
        solidCount=len(model.solids),
        volume=model.volume,
        surfaceArea=model.surface_area,
        boundingBox=model.bounding_box,
        tessellation=tessellation,
        exports=exports,
        durationMs=int((time.monotonic() - started) * 1000),
        **versions,
    )


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        sys.stderr.write("usage: python -m breadboard_cad.worker <job.json> <result.json>\n")
        return 2
    job_path, result_path = argv[1], argv[2]

    # A job file is either a build (a program) or a convert (a file). The
    # discriminator is optional so a build job keeps exactly the shape it had.
    convert = False
    try:
        with open(job_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        convert = isinstance(payload, dict) and payload.get("kind") == "convert"
        request: BuildRequest | ConvertRequest = (
            ConvertRequest.model_validate(payload.get("request"))
            if convert
            else BuildRequest.model_validate(payload)
        )
    except Exception as error:  # noqa: BLE001
        result = _failure(
            "invalid_job",
            f"The {'import' if convert else 'execution'} request could not be read: {error}",
            exceptionType=type(error).__name__,
        )
    else:
        workdir = os.path.dirname(os.path.abspath(job_path))
        # A program that computes a huge recursive shape should hit a clean
        # RecursionError long before the interpreter's C stack gives out.
        sys.setrecursionlimit(3_000)
        result = (
            run_convert(request, workdir)
            if isinstance(request, ConvertRequest)
            else run_job(request, workdir)
        )

    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(result.model_dump(by_alias=True, mode="json"), handle)
    return 0


if __name__ == "__main__":  # pragma: no cover - process entry point
    raise SystemExit(main(sys.argv))
