from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any, BinaryIO

from werkzeug.serving import ThreadedWSGIServer, WSGIRequestHandler

if TYPE_CHECKING:
    from _typeshed.wsgi import WSGIEnvironment
    from werkzeug.sansio.utils import _TSSLContextArg
    from werkzeug.serving import WSGIApplication


# Werkzeug 3.1.x asks the buffered socket reader for 10 MB at a time when it
# discards unread request data after the application returns.  A 64 KiB read is
# large enough to drain efficiently without requiring a fresh 10 MB allocation
# for every request.
_DRAIN_READ_SIZE = 64 * 1024
_DEFAULT_MAX_REQUEST_WORKERS = 32


class _BoundedDrainReader:
    """Limit allocations made by Werkzeug's post-response body drain."""

    def __init__(self, stream: BinaryIO, max_read_size: int) -> None:
        self.stream = stream
        self.max_read_size = max_read_size

    def read(self, size: int = -1) -> bytes:
        if size < 0 or size > self.max_read_size:
            size = self.max_read_size
        return self.stream.read(size)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.stream, name)


class MemoryEfficientWSGIRequestHandler(WSGIRequestHandler):
    """Run Werkzeug's residual request-body drain in bounded chunks.

    ``make_environ`` first gives the application the original request stream,
    then replaces only the handler's later reference with a bounded reader.
    Request parsing therefore keeps its normal WSGI semantics, while the
    discard loop in ``WSGIRequestHandler.run_wsgi`` cannot request a 10 MB
    temporary buffer.  ``run_wsgi`` restores the original stream before the
    base request handler performs connection cleanup.
    """

    drain_read_size = _DRAIN_READ_SIZE

    def make_environ(self) -> WSGIEnvironment:
        environ = super().make_environ()
        self.rfile = _BoundedDrainReader(self.rfile, self.drain_read_size)  # type: ignore[assignment]
        return environ

    def run_wsgi(self) -> None:
        try:
            super().run_wsgi()
        finally:
            if isinstance(self.rfile, _BoundedDrainReader):
                self.rfile = self.rfile.stream


class BoundedThreadPoolWSGIServer(ThreadedWSGIServer):
    """Serve concurrent requests with a fixed-size reusable thread pool.

    Werkzeug's development server normally creates one new OS thread for every
    accepted connection. Long-running Council requests can overlap health and
    recovery probes for hours, so an unbounded server can eventually fail in
    ``threading.Thread.start`` and take the whole desktop stack down. A fixed
    pool preserves concurrency while applying backpressure in an in-process
    queue instead of consuming an unbounded number of OS threads.
    """

    def __init__(
        self,
        host: str,
        port: int,
        app: WSGIApplication,
        handler: type[WSGIRequestHandler] | None = None,
        passthrough_errors: bool = False,
        ssl_context: _TSSLContextArg | None = None,
        fd: int | None = None,
        *,
        max_workers: int = _DEFAULT_MAX_REQUEST_WORKERS,
    ) -> None:
        if max_workers < 1:
            raise ValueError("max_workers must be positive")
        self.max_request_workers = max_workers
        self._request_executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="chatmock-http",
        )
        try:
            super().__init__(
                host,
                port,
                app,
                handler,
                passthrough_errors,
                ssl_context,
                fd,
            )
        except BaseException:
            self._request_executor.shutdown(wait=False, cancel_futures=True)
            raise

    def process_request(self, request: Any, client_address: Any) -> None:
        try:
            self._request_executor.submit(
                self.process_request_thread,
                request,
                client_address,
            )
        except RuntimeError:
            # The executor is shutting down or the OS refused another worker.
            # Close this connection without killing the accept loop; existing
            # durable callers can recover by receipt on their next attempt.
            self.shutdown_request(request)

    def server_close(self) -> None:
        try:
            super().server_close()
        finally:
            self._request_executor.shutdown(wait=True, cancel_futures=True)


def run_memory_efficient_server(
    app: WSGIApplication,
    *,
    host: str,
    port: int,
    max_workers: int = _DEFAULT_MAX_REQUEST_WORKERS,
) -> None:
    """Run ChatMock's WSGI app with bounded request concurrency."""

    server = BoundedThreadPoolWSGIServer(
        host,
        port,
        app,
        MemoryEfficientWSGIRequestHandler,
        max_workers=max_workers,
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
