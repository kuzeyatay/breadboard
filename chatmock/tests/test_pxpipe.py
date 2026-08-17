from __future__ import annotations

import socket
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from chatmock.providers import pxpipe
from chatmock.providers.types import ProviderError


class ListeningPort:
    """A socket on a free loopback port, standing in for a running proxy."""

    def __enter__(self) -> int:
        self._server = socket.socket()
        self._server.bind(("127.0.0.1", 0))
        self._server.listen(1)
        # Accept in the background so a probe's connect() completes rather than
        # sitting in the backlog on platforms that are picky about it.
        self._thread = threading.Thread(target=self._accept, daemon=True)
        self._thread.start()
        return self._server.getsockname()[1]

    def _accept(self) -> None:
        try:
            while True:
                connection, _ = self._server.accept()
                connection.close()
        except OSError:
            return

    def __exit__(self, *_: object) -> None:
        self._server.close()


class PxpipeRouteTests(unittest.TestCase):
    def test_only_the_suffixed_id_asks_for_the_proxy(self) -> None:
        self.assertTrue(pxpipe.is_efficient_model("claude-fable-5-efficient"))
        self.assertTrue(pxpipe.is_efficient_model("cliproxy/claude-fable-5-efficient"))
        self.assertFalse(pxpipe.is_efficient_model("claude-fable-5"))
        self.assertFalse(pxpipe.is_efficient_model("gemini-3-pro-efficient"))

    def test_the_suffix_is_removed_before_the_id_leaves_breadboard(self) -> None:
        # Upstream has never heard of `-efficient`; it names how Breadboard sends
        # the request, not what answers it.
        self.assertEqual(pxpipe.upstream_model("claude-fable-5-efficient"), "claude-fable-5")
        self.assertEqual(pxpipe.upstream_model("claude-fable-5"), "claude-fable-5")


class PxpipeStartupTests(unittest.TestCase):
    def test_a_proxy_already_listening_is_adopted_rather_than_duplicated(self) -> None:
        # Idempotence is by observation: whatever answers on the port is the
        # proxy, whether this process started it, an earlier ChatMock did, or
        # someone ran it by hand.
        with ListeningPort() as port:
            with (
                patch.dict(
                    "os.environ",
                    {"PXPIPE_PORT": str(port), "PXPIPE_BASE_URL": ""},
                    clear=False,
                ),
                patch.object(pxpipe, "_spawn") as spawn,
            ):
                self.assertEqual(pxpipe.base_url(), f"http://127.0.0.1:{port}")
            spawn.assert_not_called()

    def test_a_configured_proxy_belongs_to_whoever_configured_it(self) -> None:
        with (
            patch.dict("os.environ", {"PXPIPE_BASE_URL": "http://10.0.0.2:9000/"}, clear=False),
            patch.object(pxpipe, "_spawn") as spawn,
        ):
            self.assertEqual(pxpipe.base_url(), "http://10.0.0.2:9000")
        spawn.assert_not_called()

    def test_a_missing_checkout_says_so_and_names_the_way_back(self) -> None:
        # This sentence becomes the assistant's answer, so it has to leave the
        # reader with something to do — including the model that needs nothing.
        with (
            patch.dict("os.environ", {"PXPIPE_BASE_URL": ""}, clear=False),
            patch.object(pxpipe, "_is_listening", return_value=False),
            patch.object(pxpipe, "_root", return_value=Path("no-such-directory")),
        ):
            with self.assertRaises(ProviderError) as raised:
                pxpipe.base_url()
        message = str(raised.exception)
        self.assertIn("pxpipe", message)
        self.assertIn("plain Claude Fable 5", message.replace("Plain", "plain"))


if __name__ == "__main__":
    unittest.main()
