"""The humanizer's loopback HTTP surface.

Standard library, for the same reason the ColPali and CAD services next door
are: three endpoints, one caller (Breadboard's own server, over 127.0.0.1, with
a per-launch bearer) and no browser clients. A web framework would add
dependencies and attack surface without adding anything.

Logging discipline is a hard rule here rather than a preference. This process
sees whole documents a person wrote or asked for, and the one thing it must
never do is write any of them down. Every log line below is a request id, a
count, a duration or a category name. There is no code path that logs text.
"""

from __future__ import annotations

import hmac
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from . import (
    DEFAULT_MAX_CHUNK_TOKENS,
    DEFAULT_MODEL_ID,
    DEFAULT_MODEL_REVISION,
    MAX_REQUEST_BYTES,
    SERVICE_VERSION,
)
from .model import Humanizer, ModelError, ModelNotInstalledError
from .pipeline import CancelledError, PipelineError, humanize
from .schemas import (
    CancelRequest,
    ChunkCounts,
    HealthResponse,
    HumanizeRequest,
    HumanizeResponse,
    PreservationReport,
    PreservationWarning,
    TimingReport,
)

#: One rewrite at a time. Two beam searches on a 6 GB card is an out-of-memory
#: error in somebody's chat; on a CPU it is two rewrites that are each half as
#: fast. Neither is worth the concurrency, so the second caller is told it is
#: busy rather than queued behind an unbounded wait.
_INFERENCE_LOCK = threading.BoundedSemaphore(1)

#: Request ids the caller has asked to abandon. Checked between chunks.
_cancelled: set[str] = set()
_cancelled_lock = threading.Lock()
#: Bounded so a caller that cancels everything cannot grow this without limit.
_MAX_TRACKED_CANCELLATIONS = 256

#: How much of an over-sized body is read and thrown away before the connection
#: is simply dropped. Nothing is kept; this only buys the caller a real 413.
MAX_DRAIN_BYTES = 16 * 1024 * 1024


def request_cancelled(request_id: str) -> bool:
    with _cancelled_lock:
        return request_id in _cancelled


def mark_cancelled(request_id: str) -> None:
    with _cancelled_lock:
        if len(_cancelled) >= _MAX_TRACKED_CANCELLATIONS:
            _cancelled.clear()
        _cancelled.add(request_id)


def clear_cancelled(request_id: str) -> None:
    with _cancelled_lock:
        _cancelled.discard(request_id)


def log(event: str, **fields: Any) -> None:
    """Structured, and structurally incapable of carrying user text.

    Callers pass counts and categories. Nothing in this module ever passes a
    document, a chunk, a placeholder or a literal.
    """
    payload = " ".join(str(key) + "=" + str(value) for key, value in fields.items())
    sys.stdout.write("[humanizer] " + event + (" " + payload if payload else "") + "\n")
    sys.stdout.flush()


class _Handler(BaseHTTPRequestHandler):
    server_version = "BreadboardHumanizer/" + SERVICE_VERSION
    protocol_version = "HTTP/1.1"
    secret: str = ""
    model: Humanizer
    #: The chunk budget used when a request does not name one. Configurable
    #: through BREADBOARD_HUMANIZER_MAX_CHUNK_TOKENS so a machine with a
    #: different tolerance does not need a client change.
    max_chunk_tokens: int = DEFAULT_MAX_CHUNK_TOKENS

    # The supervisor captures our stdout; per-request access logs would bury
    # the structured lines above, and BaseHTTPRequestHandler puts the request
    # path in them.
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

    def _read_body(self, max_bytes: int = MAX_REQUEST_BYTES) -> tuple[dict[str, Any] | None, str]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None, "invalid_content_length"
        if length <= 0:
            return None, "empty_body"
        if length > max_bytes:
            # Discard it in bounded pieces rather than buffering it. Answering
            # without reading at all resets the connection on Windows, so the
            # caller sees a broken socket instead of the 413 that would have
            # told them what was wrong; buffering it would make the size limit
            # a memory limit that does not work. Neither: read and drop.
            self._drain(length)
            return None, "request_too_large"
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception:
            return None, "invalid_json"
        return (parsed, "") if isinstance(parsed, dict) else (None, "invalid_json")

    def _drain(self, length: int) -> None:
        """Read and discard an over-sized body, up to a hard stop."""
        remaining = min(length, MAX_DRAIN_BYTES)
        while remaining > 0:
            chunk = self.rfile.read(min(65_536, remaining))
            if not chunk:
                return
            remaining -= len(chunk)

    # -- routes -----------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path.split("?")[0] != "/health":
            self._send(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return

        model = self.model
        probe = model.probe()
        installed = model.installed()
        busy = not _INFERENCE_LOCK.acquire(blocking=False)
        if not busy:
            _INFERENCE_LOCK.release()

        broken = bool(probe.get("error")) or bool(model.load_error)
        response = HealthResponse(
            status="degraded" if broken else ("busy" if busy else "ok"),
            modelState=(
                "loaded" if model.loaded else ("installed_not_loaded" if installed else "not_installed")
            ),
            serviceVersion=SERVICE_VERSION,
            pythonVersion=sys.version.split()[0],
            torchVersion=probe.get("torch", ""),
            transformersVersion=probe.get("transformers", ""),
            cudaVersion=probe.get("cuda", ""),
            modelId=model.model_id,
            modelRevision=model.model_revision,
            device=model.device if model.loaded else probe.get("device", "unknown"),
            dtype=model.dtype,
            modelLoaded=model.loaded,
            modelInstalled=installed,
            busy=busy,
            detail=probe.get("error", "") or model.load_error,
        )
        self._send(200, response.model_dump(by_alias=True, mode="json"))

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        route = self.path.split("?")[0]
        if route not in {"/humanize", "/cancel"}:
            self._send(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return

        payload, reason = self._read_body()
        if payload is None:
            if reason == "request_too_large":
                log("request_too_large")
                self.close_connection = True
            self._send(413 if reason == "request_too_large" else 400, {"error": reason})
            return

        if route == "/cancel":
            try:
                cancel = CancelRequest.model_validate(payload)
            except Exception as error:
                self._send(422, {"error": "invalid_request", "detail": str(error)[:2_000]})
                return
            mark_cancelled(cancel.request_id)
            log("cancel", request=cancel.request_id)
            self._send(200, {"cancelled": True})
            return

        try:
            request = HumanizeRequest.model_validate(payload)
        except Exception as error:
            self._send(422, {"error": "invalid_request", "detail": str(error)[:2_000]})
            return

        if not _INFERENCE_LOCK.acquire(blocking=False):
            log("busy", request=request.request_id)
            self._send(503, {"error": "humanizer_busy"})
            return
        try:
            self._handle_humanize(request)
        except ModelNotInstalledError:
            log("model_not_installed", request=request.request_id)
            self._send(409, {"error": "humanizer_model_not_installed"})
        except CancelledError:
            log("cancelled", request=request.request_id)
            self._send(499, {"error": "humanizer_cancelled"})
        except PipelineError as error:
            log("invalid_input", request=request.request_id, category=type(error).__name__)
            self._send(422, {"error": "humanizer_invalid_input", "detail": str(error)[:500]})
        except ModelError as error:
            log("inference_failed", request=request.request_id, category=type(error).__name__)
            self._send(503, {"error": "humanizer_model_unavailable", "detail": str(error)[:500]})
        except Exception as error:  # noqa: BLE001 - a crash must still answer
            log("service_error", request=request.request_id, category=type(error).__name__)
            self._send(500, {"error": "humanizer_service_error", "detail": type(error).__name__})
        finally:
            clear_cancelled(request.request_id)
            _INFERENCE_LOCK.release()

    def _handle_humanize(self, request: HumanizeRequest) -> None:
        model = self.model
        started = time.monotonic()
        load_started = time.monotonic()
        already_loaded = model.loaded
        # Touching the tokenizer is what loads the model, and timing it
        # separately is the difference between "the model is slow" and "the
        # model was cold", which are different problems.
        model.count_tokens("")
        load_ms = 0 if already_loaded else int((time.monotonic() - load_started) * 1000)

        # An explicit budget wins; otherwise the service's configured default,
        # which is what the environment variable sets.
        budget = (
            request.max_chunk_tokens
            if "max_chunk_tokens" in request.model_fields_set
            else self.max_chunk_tokens
        )
        result = humanize(
            request.text,
            model,
            max_chunk_tokens=budget,
            should_cancel=lambda: request_cancelled(request.request_id),
        )
        total_ms = int((time.monotonic() - started) * 1000)

        response = HumanizeResponse(
            requestId=request.request_id,
            status="complete" if result.preservation_passed else "preservation_failed",
            modelId=model.model_id,
            modelRevision=model.model_revision,
            device=model.device,
            dtype=model.dtype,
            originalText=result.original_text,
            rewrittenText=result.rewritten_text,
            chunks=ChunkCounts(
                total=result.total_chunks,
                rewritten=result.rewritten_chunks,
                reverted=result.reverted_chunks,
            ),
            preservation=PreservationReport(
                passed=result.preservation_passed,
                warnings=[
                    PreservationWarning.model_validate(warning.as_dict())
                    for warning in result.warnings
                ],
            ),
            timingMs=TimingReport(
                load=load_ms, inference=result.inference_ms, total=total_ms
            ),
        )
        log(
            "humanize",
            request=request.request_id,
            chars=len(request.text),
            chunks=result.total_chunks,
            rewritten=result.rewritten_chunks,
            reverted=result.reverted_chunks,
            preserved=result.preservation_passed,
            model=model.model_id,
            device=model.device,
            dtype=model.dtype,
            ms=total_ms,
        )
        self._send(200, response.model_dump(by_alias=True, mode="json"))


def build_handler(
    secret: str, model: Humanizer, max_chunk_tokens: int = DEFAULT_MAX_CHUNK_TOKENS
) -> type[_Handler]:
    """A handler class bound to one secret and one model.

    Class attributes rather than a constructor because that is the shape
    `BaseHTTPRequestHandler` imposes; the tests subclass this the same way.
    """
    return type(
        "_BoundHandler",
        (_Handler,),
        {"secret": secret, "model": model, "max_chunk_tokens": max_chunk_tokens},
    )


def preload_model(model: Humanizer) -> bool:
    """Load an installed model before the service announces readiness.

    An absent or broken checkpoint remains a health state rather than a process
    crash. That keeps this optional leaf from preventing Breadboard startup,
    while an installed checkpoint is warm by the time the startup sequence
    considers the service ready.
    """
    if not model.installed():
        log("preload_skipped", reason="model_not_installed")
        return False
    log("preload_started", model=model.model_id)
    try:
        # Counting an empty input exercises the real tokenizer/model loader
        # without running generation or handling any user text.
        model.count_tokens("")
    except Exception as error:  # noqa: BLE001 - exposed through /health
        log("preload_failed", category=type(error).__name__)
        return False
    log("preload_complete", model=model.model_id, device=model.device, dtype=model.dtype)
    return True


def serve(
    host: str,
    port: int,
    secret: str,
    model_id: str = DEFAULT_MODEL_ID,
    model_revision: str = DEFAULT_MODEL_REVISION,
    device: str = "auto",
    idle_seconds: float | None = None,
    max_chunk_tokens: int = DEFAULT_MAX_CHUNK_TOKENS,
    preload: bool = False,
) -> None:
    from . import DEFAULT_IDLE_UNLOAD_SECONDS
    from .model import BartHumanizer

    model = BartHumanizer(
        model_id=model_id,
        model_revision=model_revision,
        device=device,
        idle_seconds=DEFAULT_IDLE_UNLOAD_SECONDS if idle_seconds is None else idle_seconds,
    )
    if preload:
        preload_model(model)
    server = ThreadingHTTPServer(
        (host, port), build_handler(secret, model, max_chunk_tokens)
    )
    server.daemon_threads = True
    log(
        "listening",
        host=host,
        port=port,
        model=model_id,
        revision=model_revision,
        device=device,
        chunk_tokens=max_chunk_tokens,
    )
    try:
        server.serve_forever()
    finally:
        model.unload()
        server.server_close()
