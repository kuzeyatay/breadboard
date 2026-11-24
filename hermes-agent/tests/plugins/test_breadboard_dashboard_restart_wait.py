"""A dashboard restart must not fail a tool call that never reached it."""
import socket
import threading
import time

import plugins.breadboard as breadboard


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def test_waits_until_dashboard_listens_again():
    port = _free_port()
    server = socket.socket()

    def come_back():
        time.sleep(1.5)
        server.bind(("127.0.0.1", port))
        server.listen()

    threading.Thread(target=come_back, daemon=True).start()
    started = time.monotonic()
    breadboard._wait_for_dashboard("127.0.0.1", port, budget=10)
    waited = time.monotonic() - started
    server.close()
    assert 1.0 <= waited < 9


def test_gives_up_after_budget():
    port = _free_port()
    started = time.monotonic()
    breadboard._wait_for_dashboard("127.0.0.1", port, budget=2)
    assert time.monotonic() - started < 4
