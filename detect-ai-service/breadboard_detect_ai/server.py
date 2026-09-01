"""Authenticated loopback HTTP boundary for the isolated detector worker."""

from __future__ import annotations

import hmac
import json
import re
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .observability import emit
from .worker import DetectionWorker, Job

MAX_REQUEST_BYTES = 28 * 1024 * 1024
REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,200}$")


def serve(host: str, port: int, secret: str, worker: DetectionWorker) -> None:
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("Detect AI may bind only to loopback")
    if len(secret) < 24:
        raise ValueError("a service secret of at least 24 characters is required")

    class Handler(BaseHTTPRequestHandler):
        server_version = "BreadboardDetectAI/1.0"

        def log_message(self, _format: str, *_args: object) -> None:
            # Request paths can contain opaque ids but never content. Normal
            # access logging is still disabled to keep service output minimal.
            return

        def _authorized(self) -> bool:
            supplied = self.headers.get("authorization", "")
            return hmac.compare_digest(supplied, f"Bearer {secret}")

        def _json(self, status: int, value: dict[str, object]) -> None:
            encoded = json.dumps(value, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def _require_auth(self) -> bool:
            if self._authorized():
                return True
            self._json(401, {"ok": False, "error": "unauthorized"})
            return False

        def do_GET(self) -> None:  # noqa: N802
            if not self._require_auth():
                return
            parsed = urlparse(self.path)
            if parsed.path == "/health":
                self._json(200, {"ok": True, **worker.health()})
                return
            match = re.fullmatch(r"/requests/([A-Za-z0-9_-]{8,200})", parsed.path)
            if not match:
                self._json(404, {"ok": False, "error": "not_found"})
                return
            since_text = parse_qs(parsed.query).get("since", ["0"])[0]
            try:
                since = max(0, int(since_text))
                self._json(200, {"ok": True, **worker.view(match.group(1), since)})
            except KeyError:
                self._json(404, {"ok": False, "error": "request_not_found"})
            except ValueError:
                self._json(400, {"ok": False, "error": "invalid_since"})

        def do_POST(self) -> None:  # noqa: N802
            if not self._require_auth():
                return
            if self.path == "/detect":
                try:
                    length = int(self.headers.get("content-length") or 0)
                except ValueError:
                    self._json(400, {"ok": False, "error": "invalid_content_length"})
                    return
                if length <= 0 or length > MAX_REQUEST_BYTES:
                    self._json(413, {"ok": False, "error": "payload_too_large"})
                    return
                try:
                    body = json.loads(self.rfile.read(length))
                    request_id = body.get("requestId")
                    if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
                        raise ValueError("invalid requestId")
                    item = body.get("item")
                    options = body.get("options") or {}
                    if not isinstance(item, dict) or not isinstance(options, dict):
                        raise ValueError("item and options must be objects")
                    worker.submit(Job(request_id=request_id, item=item, options=options))
                    self._json(202, {"ok": True, "requestId": request_id, "status": "queued"})
                except queue.Full:
                    self._json(429, {"ok": False, "error": "worker_queue_full"})
                except (json.JSONDecodeError, ValueError) as error:
                    self._json(400, {"ok": False, "error": str(error)[:300]})
                return
            match = re.fullmatch(r"/requests/([A-Za-z0-9_-]{8,200})/cancel", self.path)
            if match:
                try:
                    self._json(200, {"ok": True, "cancelled": worker.cancel(match.group(1))})
                except KeyError:
                    self._json(404, {"ok": False, "error": "request_not_found"})
                return
            self._json(404, {"ok": False, "error": "not_found"})

    # Imported here so the service module remains importable in stdlib-only tests.
    import queue

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    emit("service.started", status="ready")
    shutdown_started = threading.Event()

    def shutdown(_signum: int, _frame: object) -> None:
        if shutdown_started.is_set():
            return
        shutdown_started.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        worker.close()
        emit("service.stopped", status="stopped")
