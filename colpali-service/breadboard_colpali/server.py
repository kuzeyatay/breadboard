"""The ColPali service's loopback HTTP surface.

Standard library, for the same reason the CAD service next door is: four
endpoints, one caller (Breadboard's own server, over 127.0.0.1, with a
per-launch shared secret) and no browser clients. A web framework would add
dependencies and attack surface without adding anything.

Unlike the CAD service, the model is held *in* this process. It has to be — a
per-request child would reload a gigabyte of weights every question. The idle
timer in `embedder` is what keeps that from being a permanent claim on the card.
"""

from __future__ import annotations

import hmac
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from . import MAX_INDEXED_PAGES, SERVICE_VERSION
from .embedder import Embedder, EmbedderError, decode_page_image
from .index_store import IndexStore
from .models import (
    HealthResponse,
    IndexRequest,
    IndexResponse,
    ScoredPage,
    SearchRequest,
    SearchResponse,
)

#: One job at a time. Two documents embedding at once on a 6 GB card is how you
#: turn a background index into an out-of-memory error in somebody's chat.
_GPU_SEMAPHORE = threading.BoundedSemaphore(1)

MAX_REQUEST_BYTES = 2 * 1024 * 1024
#: An index request carries every page of a document as base64 PNG. Three
#: hundred pages at 1200px is the ceiling this has to clear.
MAX_INDEX_REQUEST_BYTES = 512 * 1024 * 1024


class _Handler(BaseHTTPRequestHandler):
    server_version = f"BreadboardColPali/{SERVICE_VERSION}"
    protocol_version = "HTTP/1.1"
    secret: str = ""
    embedder: Embedder
    store: IndexStore

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

        probe = self.embedder.probe()
        # "ok" means the service could embed if asked, not that it is holding a
        # model right now. Degraded means torch is missing or broken, or a load
        # has already been tried and failed — a CPU-only box is healthy, just
        # slow, and says so through `device`.
        broken = "error" in probe or self.embedder.load_error
        response = HealthResponse(
            status="degraded" if broken else "ok",
            serviceVersion=SERVICE_VERSION,
            pythonVersion=sys.version.split()[0],
            torchVersion=probe.get("torch", ""),
            cudaVersion=probe.get("cuda", ""),
            modelId=self.embedder.model_id,
            device=self.embedder.device if self.embedder.loaded else probe.get("device", "unknown"),
            dtype=self.embedder.dtype,
            modelLoaded=self.embedder.loaded,
            indexedDocuments=self.store.count(),
            detail=probe.get("error", "") or self.embedder.load_error,
        )
        self._send(200, response.model_dump(by_alias=True, mode="json"))

    def do_DELETE(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        route = self.path.split("?")[0]
        prefix = "/index/"
        if not route.startswith(prefix):
            self._send(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        document_id = route[len(prefix) :]
        try:
            SearchRequest(documentId=document_id, query="x", topK=1)
        except Exception:
            self._send(422, {"error": "invalid_document_id"})
            return
        self._send(200, {"deleted": self.store.delete(document_id)})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        route = self.path.split("?")[0]
        if route not in {"/index", "/search"}:
            self._send(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return

        indexing = route == "/index"
        payload = self._read_body(MAX_INDEX_REQUEST_BYTES if indexing else MAX_REQUEST_BYTES)
        if payload is None:
            self._send(400, {"error": "invalid_request_body"})
            return

        try:
            request = (
                IndexRequest.model_validate(payload)
                if indexing
                else SearchRequest.model_validate(payload)
            )
        except Exception as error:
            self._send(422, {"error": "invalid_request", "detail": str(error)[:2_000]})
            return

        # Indexing can run for minutes on a long document; a query behind it
        # would rather wait than fail, but not forever.
        if not _GPU_SEMAPHORE.acquire(timeout=900 if indexing else 120):
            self._send(503, {"error": "colpali_service_busy"})
            return
        try:
            if isinstance(request, IndexRequest):
                self._handle_index(request)
            else:
                self._handle_search(request)
        except EmbedderError as error:
            self._send(503, {"error": "colpali_model_unavailable", "detail": str(error)[:2_000]})
        except Exception as error:  # noqa: BLE001 - a crash must still answer
            self._send(
                500,
                {"error": "colpali_service_error", "detail": f"{type(error).__name__}: {error}"[:2_000]},
            )
        finally:
            _GPU_SEMAPHORE.release()

    def _handle_index(self, request: IndexRequest) -> None:
        pages = sorted(request.pages, key=lambda page: page.page_number)
        truncated = len(pages) > MAX_INDEXED_PAGES
        pages = pages[:MAX_INDEXED_PAGES]

        images = [decode_page_image(page.image_base64) for page in pages]
        vectors = self.embedder.embed_pages(images)
        page_numbers = [page.page_number for page in pages]
        self.store.write(request.document_id, self.embedder.model_id, page_numbers, vectors)

        response = IndexResponse(
            documentId=request.document_id,
            pages=len(page_numbers),
            dimensions=int(vectors[0].shape[1]) if vectors else 0,
            modelId=self.embedder.model_id,
            truncated=truncated,
        )
        self._send(200, response.model_dump(by_alias=True, mode="json"))

    def _handle_search(self, request: SearchRequest) -> None:
        index = self.store.read(request.document_id)
        if index is None:
            self._send(404, {"error": "not_indexed"})
            return
        # A model change invalidates every vector written by the old one: the
        # two embed into different spaces, and scoring across them would return
        # confident nonsense rather than an error.
        if index.model_id != self.embedder.model_id:
            self._send(
                409,
                {
                    "error": "stale_index",
                    "detail": f"indexed with {index.model_id}, service runs {self.embedder.model_id}",
                },
            )
            return

        scores = self.embedder.score(request.query, index.vectors)
        ranked = sorted(
            (
                ScoredPage(pageNumber=page, score=score)
                for page, score in zip(index.page_numbers, scores, strict=False)
            ),
            key=lambda page: page.score,
            reverse=True,
        )[: request.top_k]

        response = SearchResponse(
            documentId=request.document_id,
            modelId=self.embedder.model_id,
            pages=ranked,
        )
        self._send(200, response.model_dump(by_alias=True, mode="json"))


def serve(host: str, port: int, secret: str, index_root: str, model_id: str | None = None) -> None:
    from . import DEFAULT_MODEL_ID

    _Handler.secret = secret
    _Handler.embedder = Embedder(model_id or DEFAULT_MODEL_ID)
    _Handler.store = IndexStore(index_root)

    server = ThreadingHTTPServer((host, port), _Handler)
    server.daemon_threads = True
    sys.stdout.write(f"breadboard_colpali {SERVICE_VERSION} listening on {host}:{port}\n")
    sys.stdout.flush()
    try:
        server.serve_forever()
    finally:
        _Handler.embedder.unload()
        server.server_close()
