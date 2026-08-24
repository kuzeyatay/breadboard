from __future__ import annotations

from typing import TYPE_CHECKING, Any, BinaryIO

from werkzeug.serving import WSGIRequestHandler

if TYPE_CHECKING:
    from _typeshed.wsgi import WSGIEnvironment


# Werkzeug 3.1.x asks the buffered socket reader for 10 MB at a time when it
# discards unread request data after the application returns.  A 64 KiB read is
# large enough to drain efficiently without requiring a fresh 10 MB allocation
# for every request.
_DRAIN_READ_SIZE = 64 * 1024


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
