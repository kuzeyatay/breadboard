"""Process supervision for one CAD execution.

The service process never runs generated code. It writes a job file into a fresh
directory, starts ``python -m breadboard_cad.worker`` there, waits with a hard
deadline, and reads back a result file. On timeout the whole process tree is
killed — OpenCascade spawns nothing today, but a program that found a way to
would otherwise outlive its supervisor.

Everything that leaves this module is typed. No caller ever parses a terminal
string to find out what happened.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

from typing import Any

from .guard import check_source
from .models import (
    BuildRequest,
    BuildResult,
    ConvertRequest,
    ExecutionFailure,
    ExportedFile,
)
from .worker import IMPORT_FILENAME

#: Captured child output is for debugging, never for control flow.
MAX_CAPTURED_OUTPUT = 16_000
#: A result file larger than this is a malfunction, not a model.
MAX_RESULT_BYTES = 8 * 1024 * 1024
#: One export may not exceed this. A 3D-printable part is far smaller.
MAX_EXPORT_BYTES = 96 * 1024 * 1024
#: An imported exchange file may not exceed this. Larger boundary-representation
#: assemblies tessellate into meshes no browser would draw anyway.
MAX_IMPORT_BYTES = 32 * 1024 * 1024
#: Grace between the polite terminate and the tree kill.
KILL_GRACE_SECONDS = 2.0


class ExecutionError(Exception):
    def __init__(self, failure: ExecutionFailure) -> None:
        super().__init__(failure.message)
        self.failure = failure


def _child_environment(workdir: str) -> dict[str, str]:
    """A minimal environment: enough to start an interpreter, nothing else.

    The service may be started by the desktop supervisor with API keys, session
    tokens and database paths in its environment. None of that is any use to a
    part description, so none of it is inherited.

    The child's home directory is a throwaway inside its own workspace. Parts of
    CadQuery's import chain insist on resolving one (and fail the import
    outright when they cannot), so the choice is between handing the child the
    real user profile and giving it an empty one that dies with the execution.
    """
    keep = ("SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "LANG", "LC_ALL")
    environment: dict[str, str] = {}
    for name in keep:
        value = os.environ.get(name)
        if value:
            environment[name] = value

    home = os.path.join(workdir, "home")
    os.makedirs(home, exist_ok=True)
    environment["HOME"] = home
    environment["USERPROFILE"] = home
    environment["APPDATA"] = home
    environment["LOCALAPPDATA"] = home
    environment["XDG_CACHE_HOME"] = home
    environment["XDG_CONFIG_HOME"] = home
    environment["MPLCONFIGDIR"] = home
    environment["TEMP"] = workdir
    environment["TMP"] = workdir
    environment["TMPDIR"] = workdir
    if sys.platform == "win32":
        drive, tail = os.path.splitdrive(home)
        environment["HOMEDRIVE"] = drive or "C:"
        environment["HOMEPATH"] = tail or "\\"

    environment["PATH"] = os.path.dirname(sys.executable)
    environment["PYTHONPATH"] = _package_root()
    environment["PYTHONNOUSERSITE"] = "1"
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    environment["PYTHONUNBUFFERED"] = "1"
    environment["PYTHONHASHSEED"] = "0"
    # Keep OCCT and any BLAS underneath it single-threaded: a build is one
    # part, and unbounded thread pools make the timeout meaningless.
    for variable in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        environment[variable] = "1"
    return environment


def _package_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _kill_tree(process: subprocess.Popen[bytes]) -> None:
    """Terminate the child and everything it started."""
    if process.poll() is not None:
        return
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                timeout=10,
                check=False,
            )
        except Exception:
            pass
        if process.poll() is None:
            try:
                process.kill()
            except Exception:
                pass
    else:
        import signal

        try:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass
    try:
        process.wait(timeout=5)
    except Exception:
        pass


def _truncate(payload: bytes) -> str:
    text = payload.decode("utf-8", errors="replace")
    if len(text) <= MAX_CAPTURED_OUTPUT:
        return text
    return text[:MAX_CAPTURED_OUTPUT] + f"\n… ({len(text) - MAX_CAPTURED_OUTPUT} more characters)"


def _safe_output_path(workdir: str, filename: str) -> str:
    """Resolve a produced filename inside the workdir, or refuse it.

    Filenames come from the request, which came from Breadboard, which derives
    them from a fixed format list — but the check is unconditional anyway. A
    filename is never trusted because of where it was supposed to come from.
    """
    if not filename or filename != os.path.basename(filename):
        raise ExecutionError(
            ExecutionFailure(code="invalid_export_path", message="An export filename is not a bare name.")
        )
    if "\x00" in filename or filename in {".", ".."}:
        raise ExecutionError(
            ExecutionFailure(code="invalid_export_path", message="An export filename is not usable.")
        )
    root = os.path.realpath(workdir)
    target = os.path.realpath(os.path.join(root, filename))
    if os.path.commonpath([root, target]) != root:
        raise ExecutionError(
            ExecutionFailure(
                code="export_escaped_workspace",
                message="An export resolved outside its execution workspace.",
            )
        )
    return target


class ExecutionOutcome:
    """A completed execution plus the bytes it produced."""

    def __init__(self, result: BuildResult, files: dict[str, bytes]) -> None:
        self.result = result
        self.files = files


def execute(request: BuildRequest, workspace_root: str | None = None) -> ExecutionOutcome:
    """Run one CAD program under supervision and return its typed result."""

    admission = check_source(request.source, request.entrypoint)
    if not admission.ok:
        return ExecutionOutcome(
            BuildResult(
                ok=False,
                failure=ExecutionFailure(
                    code="forbidden_source",
                    message="The CAD source was refused before execution.",
                    violations=[violation.as_dict() for violation in admission.violations],
                ),
            ),
            {},
        )

    return _supervise(
        request.model_dump(by_alias=True, mode="json"),
        request.timeout_ms,
        workspace_root,
    )


def convert(request: ConvertRequest, workspace_root: str | None = None) -> ExecutionOutcome:
    """Read one CAD exchange file under supervision and mesh it.

    There is no program here and so no admission control — the untrusted input
    is the file. It is written into the same throwaway workspace a generated
    program would run in, under a name this module chooses, and read by the same
    short-lived worker, so a file that crashes OpenCascade costs one request.
    """
    try:
        payload = base64.b64decode(request.content_base64, validate=True)
    except Exception:
        return ExecutionOutcome(
            BuildResult(
                ok=False,
                failure=ExecutionFailure(
                    code="invalid_import_payload",
                    message="The file to import was not valid base64.",
                ),
            ),
            {},
        )
    if not payload:
        return ExecutionOutcome(
            BuildResult(
                ok=False,
                failure=ExecutionFailure(
                    code="invalid_import_payload", message="The file to import is empty."
                ),
            ),
            {},
        )
    if len(payload) > MAX_IMPORT_BYTES:
        return ExecutionOutcome(
            BuildResult(
                ok=False,
                failure=ExecutionFailure(
                    code="import_too_large",
                    message=f"The file to import is {len(payload)} bytes, above the "
                    f"{MAX_IMPORT_BYTES} byte limit.",
                ),
            ),
            {},
        )

    return _supervise(
        {"kind": "convert", "request": request.model_dump(by_alias=True, mode="json")},
        request.timeout_ms,
        workspace_root,
        input_file=(IMPORT_FILENAME, payload),
    )


def _supervise(
    job_payload: dict[str, Any],
    timeout_ms: int,
    workspace_root: str | None,
    input_file: tuple[str, bytes] | None = None,
) -> ExecutionOutcome:
    """Run one worker in a throwaway workspace and read back its result."""

    root = workspace_root or os.path.join(tempfile.gettempdir(), "breadboard-cad")
    os.makedirs(root, exist_ok=True)
    workdir = os.path.join(root, f"exec-{uuid.uuid4().hex}")
    os.makedirs(workdir, exist_ok=False)

    job_path = os.path.join(workdir, "job.json")
    result_path = os.path.join(workdir, "result.json")
    started = time.monotonic()

    try:
        if input_file is not None:
            name, content = input_file
            with open(_safe_output_path(workdir, name), "wb") as binary:
                binary.write(content)

        with open(job_path, "w", encoding="utf-8") as handle:
            json.dump(job_payload, handle)

        popen_extra: dict[str, object] = {}
        if sys.platform == "win32":
            popen_extra["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            popen_extra["start_new_session"] = True

        # `-s` keeps the user site-packages out, `-B` writes no bytecode into the
        # workspace. `-I` is deliberately not used: it implies `-E`, which would
        # discard the PYTHONPATH that makes this package importable.
        process = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
            [sys.executable, "-s", "-B", "-m", "breadboard_cad.worker", job_path, result_path],
            cwd=workdir,
            env=_child_environment(workdir),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            **popen_extra,  # type: ignore[arg-type]
        )

        timed_out = False
        try:
            stdout, stderr = process.communicate(timeout=timeout_ms / 1000)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                process.terminate()
                stdout, stderr = process.communicate(timeout=KILL_GRACE_SECONDS)
            except Exception:
                stdout, stderr = b"", b""
            _kill_tree(process)

        duration_ms = int((time.monotonic() - started) * 1000)

        if timed_out:
            return ExecutionOutcome(
                BuildResult(
                    ok=False,
                    failure=ExecutionFailure(
                        code="execution_timeout",
                        message=f"The model did not finish within {timeout_ms} ms and its "
                        "process tree was terminated.",
                    ),
                    stdout=_truncate(stdout),
                    stderr=_truncate(stderr),
                    durationMs=duration_ms,
                ),
                {},
            )

        if not os.path.isfile(result_path):
            return ExecutionOutcome(
                BuildResult(
                    ok=False,
                    failure=ExecutionFailure(
                        code="worker_crashed",
                        message=f"The CAD worker exited with code {process.returncode} without "
                        "writing a result. This is usually an OpenCascade crash.",
                    ),
                    stdout=_truncate(stdout),
                    stderr=_truncate(stderr),
                    durationMs=duration_ms,
                ),
                {},
            )

        if os.path.getsize(result_path) > MAX_RESULT_BYTES:
            return ExecutionOutcome(
                BuildResult(
                    ok=False,
                    failure=ExecutionFailure(
                        code="result_too_large",
                        message="The CAD worker produced an oversized result document.",
                    ),
                    durationMs=duration_ms,
                ),
                {},
            )

        with open(result_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        result = BuildResult.model_validate(payload)
        result = result.model_copy(
            update={
                "stdout": _truncate(stdout),
                "stderr": _truncate(stderr),
                "duration_ms": result.duration_ms or duration_ms,
            }
        )

        files: dict[str, bytes] = {}
        if result.ok:
            verified: list[ExportedFile] = []
            for export in result.exports:
                path = _safe_output_path(workdir, export.filename)
                if not os.path.isfile(path):
                    raise ExecutionError(
                        ExecutionFailure(
                            code="export_missing",
                            message=f"The {export.format.upper()} export is missing from the "
                            "execution workspace.",
                        )
                    )
                size = os.path.getsize(path)
                if size > MAX_EXPORT_BYTES:
                    raise ExecutionError(
                        ExecutionFailure(
                            code="export_too_large",
                            message=f"The {export.format.upper()} export is {size} bytes, above "
                            f"the {MAX_EXPORT_BYTES} byte limit.",
                        )
                    )
                with open(path, "rb") as handle:
                    payload_bytes = handle.read()
                digest = hashlib.sha256(payload_bytes).hexdigest()
                if digest != export.sha256 or len(payload_bytes) != export.byte_size:
                    raise ExecutionError(
                        ExecutionFailure(
                            code="export_hash_mismatch",
                            message=f"The {export.format.upper()} export changed after it was "
                            "written.",
                        )
                    )
                files[export.format] = payload_bytes
                verified.append(export)
            result = result.model_copy(update={"exports": verified})

        return ExecutionOutcome(result, files)
    except ExecutionError as error:
        return ExecutionOutcome(BuildResult(ok=False, failure=error.failure), {})
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
