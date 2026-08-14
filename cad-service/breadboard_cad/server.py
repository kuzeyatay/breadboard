"""The CAD service's loopback HTTP surface.

Deliberately built on the standard library. The service has three endpoints,
one caller (Breadboard's own server, over 127.0.0.1, with a per-launch shared
secret) and no browser clients, so a web framework would add dependencies and
attack surface without adding anything.

The kernel is never imported into this process. Every build is a separate
``breadboard_cad.worker`` process, so an OpenCascade crash costs one request.
"""

from __future__ import annotations

import base64
import hmac
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from . import SERVICE_VERSION
from .executor import convert, execute
from .models import IMPORT_FORMATS, BuildRequest, ConvertRequest, HealthResponse

#: One build at a time per service. OpenCascade is memory-hungry and a queue of
#: them on a laptop is worse than a short wait.
_BUILD_SEMAPHORE = threading.BoundedSemaphore(2)

MAX_REQUEST_BYTES = 4 * 1024 * 1024
#: An import carries the user's file inline as base64, so its ceiling is the
#: executor's import limit plus base64's third and a little room for the rest of
#: the document. A build request is a program and stays small.
MAX_CONVERT_REQUEST_BYTES = 46 * 1024 * 1024


def _kernel_probe() -> dict[str, str]:
    """Ask a short-lived child what the kernel actually is.

    Running it out of process keeps `import cadquery` — several seconds and a
    few hundred megabytes — out of the service, and makes a broken install a
    reported health state rather than a service that will not start.
    """
    script = (
        "import json,sys\n"
        "out={'python': sys.version.split()[0]}\n"
        "try:\n"
        "    import cadquery\n"
        "    out['cadquery']=getattr(cadquery,'__version__','unknown')\n"
        "except Exception as error:\n"
        "    out['error']=f'{type(error).__name__}: {error}'\n"
        "try:\n"
        "    import importlib.metadata as m\n"
        "    out['ocp']=m.version('cadquery-ocp')\n"
        "except Exception:\n"
        "    out['ocp']='unknown'\n"
        "sys.stdout.write(json.dumps(out))\n"
    )
    try:
        completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
            [sys.executable, "-s", "-B", "-c", script],
            capture_output=True,
            timeout=120,
            check=False,
        )
        return json.loads(completed.stdout.decode("utf-8", errors="replace") or "{}")
    except Exception as error:
        return {"error": f"{type(error).__name__}: {error}", "python": sys.version.split()[0]}


class _Handler(BaseHTTPRequestHandler):
    server_version = f"BreadboardCAD/{SERVICE_VERSION}"
    protocol_version = "HTTP/1.1"
    secret: str = ""
    workspace_root: str | None = None

    # The supervisor captures our stdout; per-request access logs would bury it.
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    # -- helpers ----------------------------------------------------------
    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if not self.secret:
            return False
        header = self.headers.get("Authorization", "")
        if not header.lower().startswith("bearer "):
            return False
        return hmac.compare_digest(header[7:].strip(), self.secret)

    def _read_body(self, max_bytes: int = MAX_REQUEST_BYTES) -> dict[str, Any] | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > max_bytes:
            return None
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception:
            return None
        return parsed if isinstance(parsed, dict) else None

    # -- routes -----------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path.split("?")[0] != "/health":
            self._send(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        probe = _kernel_probe()
        healthy = "error" not in probe and probe.get("cadquery")
        response = HealthResponse(
            status="ok" if healthy else "degraded",
            serviceVersion=SERVICE_VERSION,
            pythonVersion=probe.get("python", ""),
            cadqueryVersion=probe.get("cadquery", ""),
            ocpVersion=probe.get("ocp", ""),
            exportFormats=["step", "stl", "glb", "3mf"] if healthy else [],
            importFormats=list(IMPORT_FORMATS) if healthy else [],
            # This service has exactly one engine, and it is only usable when
            # the probe found the kernel. Backends that live outside this
            # process — SolidWorks, driven from Breadboard itself — are reported
            # by Breadboard's own /api/cad/health, not claimed here.
            engines=["cadquery"] if healthy else [],
            detail=probe.get("error", ""),
        )
        self._send(200, response.model_dump(by_alias=True, mode="json"))

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        route = self.path.split("?")[0]
        # /execute runs a generated program; /convert reads a file the user
        # supplied. Both end in a meshed, measured model and the same response.
        if route not in {"/execute", "/convert"}:
            self._send(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        importing = route == "/convert"
        payload = self._read_body(
            MAX_CONVERT_REQUEST_BYTES if importing else MAX_REQUEST_BYTES
        )
        if payload is None:
            self._send(400, {"error": "invalid_request_body"})
            return
        try:
            request = (
                ConvertRequest.model_validate(payload)
                if importing
                else BuildRequest.model_validate(payload)
            )
        except Exception as error:
            self._send(422, {"error": "invalid_request", "detail": str(error)[:2_000]})
            return

        acquired = _BUILD_SEMAPHORE.acquire(timeout=120)
        if not acquired:
            self._send(503, {"error": "cad_service_busy"})
            return
        try:
            outcome = (
                convert(request, self.workspace_root)
                if isinstance(request, ConvertRequest)
                else execute(request, self.workspace_root)
            )
        except Exception as error:  # noqa: BLE001 - a crash must still answer
            self._send(
                500,
                {"error": "cad_service_error", "detail": f"{type(error).__name__}: {error}"[:2_000]},
            )
            return
        finally:
            _BUILD_SEMAPHORE.release()

        body = outcome.result.model_dump(by_alias=True, mode="json")
        # Export bytes ride back with the result as base64 rather than through a
        # second request: the executor deletes the workspace as soon as it
        # returns, so there is no file left to fetch afterwards.
        body["files"] = {
            fmt: base64.b64encode(payload_bytes).decode("ascii")
            for fmt, payload_bytes in outcome.files.items()
        }
        self._send(200, body)


def serve(host: str, port: int, secret: str, workspace_root: str | None = None) -> None:
    if not secret:
        raise SystemExit("BREADBOARD_CAD_SECRET is required; refusing to serve unauthenticated.")
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit(f"The CAD service binds loopback only; refusing host {host!r}.")

    handler = type("_BoundHandler", (_Handler,), {"secret": secret, "workspace_root": workspace_root})
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True
    bound = httpd.server_address[1]
    sys.stdout.write(f"[cad] listening on http://{host}:{bound}\n")
    sys.stdout.flush()
    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


def serve_from_environment() -> None:
    host = os.environ.get("BREADBOARD_CAD_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.environ.get("BREADBOARD_CAD_PORT", "7731").strip() or "7731")
    secret = os.environ.get("BREADBOARD_CAD_SECRET", "").strip()
    workspace = os.environ.get("BREADBOARD_CAD_WORKSPACE", "").strip() or None
    serve(host, port, secret, workspace)
