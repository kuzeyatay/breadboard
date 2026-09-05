from __future__ import annotations

import ast
import inspect
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from werkzeug.serving import WSGIRequestHandler

from chatmock.cli import cmd_serve
from chatmock.serving import (
    BoundedThreadPoolWSGIServer,
    MemoryEfficientWSGIRequestHandler,
    _BoundedDrainReader,
)


class _AllocationGuardReader:
    """A deterministic stand-in for a socket under low commit pressure."""

    def __init__(self, payload: bytes, allocation_limit: int) -> None:
        self.payload = payload
        self.allocation_limit = allocation_limit
        self.offset = 0
        self.read_sizes: list[int] = []

    def read(self, size: int = -1) -> bytes:
        self.read_sizes.append(size)
        if size < 0 or size > self.allocation_limit:
            raise MemoryError("simulated low commit pressure")
        data = self.payload[self.offset : self.offset + size]
        self.offset += len(data)
        return data


class ServingTests(unittest.TestCase):
    def test_bounded_reader_avoids_werkzeug_allocation_and_drains_all_data(self) -> None:
        # Keep this assertion tied to the pinned dependency. If Werkzeug gains a
        # bounded drain upstream, this local compatibility layer can be removed.
        werkzeug_source = inspect.getsource(WSGIRequestHandler.run_wsgi)
        self.assertIn("self.rfile.read(10_000_000)", werkzeug_source)

        payload = b"x" * (MemoryEfficientWSGIRequestHandler.drain_read_size * 3 + 17)
        unbounded = _AllocationGuardReader(
            payload,
            MemoryEfficientWSGIRequestHandler.drain_read_size,
        )
        with self.assertRaisesRegex(MemoryError, "low commit pressure"):
            unbounded.read(10_000_000)

        guarded = _AllocationGuardReader(
            payload,
            MemoryEfficientWSGIRequestHandler.drain_read_size,
        )
        drain_reader = _BoundedDrainReader(
            guarded,
            MemoryEfficientWSGIRequestHandler.drain_read_size,
        )
        drained = bytearray()
        while chunk := drain_reader.read(10_000_000):
            drained.extend(chunk)

        self.assertEqual(bytes(drained), payload)
        self.assertGreater(len(guarded.read_sizes), 1)
        self.assertLessEqual(
            max(guarded.read_sizes),
            MemoryEfficientWSGIRequestHandler.drain_read_size,
        )

    def test_handler_leaves_wsgi_input_unchanged_and_restores_socket_reader(self) -> None:
        raw_reader = _AllocationGuardReader(
            b"request-body|unread-tail",
            MemoryEfficientWSGIRequestHandler.drain_read_size,
        )
        handler = object.__new__(MemoryEfficientWSGIRequestHandler)
        handler.rfile = raw_reader
        observed: dict[str, object] = {}

        def fake_make_environ(_handler):  # type: ignore[no-untyped-def]
            return {"wsgi.input": raw_reader}

        def fake_run_wsgi(active_handler):  # type: ignore[no-untyped-def]
            environ = active_handler.make_environ()
            request_input = environ["wsgi.input"]
            observed["request_input"] = request_input
            observed["request_body"] = request_input.read(len(b"request-body|"))

            drained = bytearray()
            while chunk := active_handler.rfile.read(10_000_000):
                drained.extend(chunk)
            observed["drained"] = bytes(drained)

        with (
            patch.object(WSGIRequestHandler, "make_environ", fake_make_environ),
            patch.object(WSGIRequestHandler, "run_wsgi", fake_run_wsgi),
        ):
            handler.run_wsgi()

        self.assertIs(observed["request_input"], raw_reader)
        self.assertEqual(observed["request_body"], b"request-body|")
        self.assertEqual(observed["drained"], b"unread-tail")
        self.assertIs(handler.rfile, raw_reader)
        self.assertLessEqual(
            max(raw_reader.read_sizes),
            MemoryEfficientWSGIRequestHandler.drain_read_size,
        )

    @patch("chatmock.cli.run_memory_efficient_server")
    @patch("chatmock.cli.create_app")
    def test_serve_uses_bounded_memory_efficient_server(
        self,
        create_app,
        run_server,
    ) -> None:  # type: ignore[no-untyped-def]
        app = create_app.return_value

        result = cmd_serve(
            host="127.0.0.1",
            port=8765,
            verbose=False,
            verbose_obfuscation=False,
            reasoning_effort="low",
            reasoning_summary="detailed",
            reasoning_compat="legacy",
            fast_mode=False,
            debug_model=None,
            expose_reasoning_models=False,
            default_web_search=True,
        )

        self.assertEqual(result, 0)
        run_server.assert_called_once_with(
            app,
            host="127.0.0.1",
            port=8765,
        )

    def test_bounded_server_uses_fixed_reusable_worker_pool(self) -> None:
        server = BoundedThreadPoolWSGIServer(
            "127.0.0.1",
            0,
            lambda environ, start_response: [],
            MemoryEfficientWSGIRequestHandler,
            max_workers=3,
        )
        try:
            self.assertEqual(server.max_request_workers, 3)
            self.assertEqual(server._request_executor._max_workers, 3)
            self.assertTrue(server.multithread)
        finally:
            server.server_close()

    def test_gui_server_uses_memory_efficient_request_handler(self) -> None:
        # PySide6 is intentionally an optional dependency. Compile only the
        # server function from the supported GUI entrypoint so this test
        # exercises its real implementation in headless core installs.
        gui_path = Path(__file__).parents[1] / "gui.py"
        gui_tree = ast.parse(gui_path.read_text(encoding="utf-8"), filename=str(gui_path))
        self.assertTrue(
            any(
                isinstance(node, ast.ImportFrom)
                and node.module == "chatmock.serving"
                and any(name.name == "run_memory_efficient_server" for name in node.names)
                for node in gui_tree.body
            )
        )
        run_server = next(
            node
            for node in gui_tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "run_server"
        )
        server_module = ast.fix_missing_locations(
            ast.Module(body=[run_server], type_ignores=[])
        )

        create_app = Mock()
        namespace = {
            "create_app": create_app,
            "run_memory_efficient_server": Mock(),
        }
        exec(compile(server_module, str(gui_path), "exec"), namespace)

        namespace["run_server"]("127.0.0.1", 8000)

        app = create_app.return_value
        namespace["run_memory_efficient_server"].assert_called_once_with(
            app,
            host="127.0.0.1",
            port=8000,
        )


if __name__ == "__main__":
    unittest.main()
