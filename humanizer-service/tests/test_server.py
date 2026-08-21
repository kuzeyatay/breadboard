"""The loopback HTTP surface: authentication, limits, health, and log hygiene.

The model is faked throughout. What is worth pinning here is everything around
it: that an unauthenticated caller gets nothing, that a body which is too large
is refused before it is parsed, that "the checkpoint was never downloaded" is a
reported state rather than a crash, that a second rewrite is told it is busy
instead of queued, and - the one that would be quietly catastrophic - that no
line this service writes to stdout ever contains a word of the user's text.
"""

import io
import json
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stdout
from http.server import ThreadingHTTPServer

from breadboard_humanizer import model as model_module
from breadboard_humanizer.model import ModelError, generation_budget, resolve_device
from breadboard_humanizer.server import build_handler, preload_model

from .fakes import FakeHumanizer
from .fixtures import ACCEPTANCE_MARKDOWN

SECRET = "test-secret-value"


def request(url, *, method="GET", token=SECRET, payload=None, raw=None, headers=None):
    body = raw if raw is not None else (json.dumps(payload).encode("utf-8") if payload is not None else None)
    request_headers = {"Content-Type": "application/json", "Connection": "close"}
    if token is not None:
        request_headers["Authorization"] = "Bearer " + token
    request_headers.update(headers or {})
    call = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(call, timeout=60) as response:  # noqa: S310 - loopback only
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        with error:
            payload = error.read().decode("utf-8")
        return error.code, (json.loads(payload) if payload else {})


class ServerTestCase(unittest.TestCase):
    model_kwargs: dict = {}

    def setUp(self):
        self.model = FakeHumanizer(**self.model_kwargs)
        self.stdout = io.StringIO()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), build_handler(SECRET, self.model))
        self.httpd.daemon_threads = True
        self.base = "http://127.0.0.1:" + str(self.httpd.server_address[1])
        self._redirect = redirect_stdout(self.stdout)
        self._redirect.__enter__()
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self._redirect.__exit__(None, None, None)


class AuthenticationTest(ServerTestCase):
    def test_every_route_requires_the_shared_secret(self):
        self.assertEqual(request(self.base + "/health", token=None)[0], 401)
        self.assertEqual(request(self.base + "/health", token="wrong")[0], 401)
        self.assertEqual(
            request(self.base + "/humanize", method="POST", token=None, payload={})[0], 401
        )
        self.assertEqual(
            request(self.base + "/cancel", method="POST", token="wrong", payload={})[0], 401
        )

    def test_an_unknown_route_is_not_found(self):
        self.assertEqual(request(self.base + "/rewrite")[0], 404)
        self.assertEqual(request(self.base + "/admin", method="POST", payload={})[0], 404)


class ValidationTest(ServerTestCase):
    def test_malformed_json_is_refused(self):
        status, body = request(self.base + "/humanize", method="POST", raw=b"{not json")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "invalid_json")

    def test_an_empty_body_is_refused(self):
        status, body = request(self.base + "/humanize", method="POST", raw=b"")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "empty_body")

    def test_an_oversized_body_is_refused_before_it_is_parsed(self):
        oversized = json.dumps({"requestId": "r", "text": "x" * (2 * 1024 * 1024)}).encode("utf-8")
        status, body = request(self.base + "/humanize", method="POST", raw=oversized)
        self.assertEqual(status, 413)
        self.assertEqual(body["error"], "request_too_large")
        self.assertEqual(self.model.seen, [])

    def test_unknown_fields_are_refused(self):
        status, body = request(
            self.base + "/humanize",
            method="POST",
            payload={"requestId": "r", "text": "hello there", "serviceUrl": "http://evil"},
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"], "invalid_request")

    def test_a_chunk_budget_over_the_hard_ceiling_is_refused(self):
        status, _ = request(
            self.base + "/humanize",
            method="POST",
            payload={"requestId": "r", "text": "hello there", "maxChunkTokens": 5_000},
        )
        self.assertEqual(status, 422)


class HealthTest(ServerTestCase):
    def test_installed_but_not_loaded(self):
        status, body = request(self.base + "/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["modelState"], "installed_not_loaded")
        self.assertTrue(body["modelInstalled"])
        self.assertFalse(body["modelLoaded"])
        self.assertEqual(body["modelId"], "cive202/humanize-ai-text-bart-large")
        self.assertEqual(body["torchVersion"], "2.6.0")
        self.assertEqual(body["transformersVersion"], "4.44.2")

    def test_loaded_after_a_rewrite(self):
        request(
            self.base + "/humanize",
            method="POST",
            payload={"requestId": "r1", "text": "Some ordinary prose to rewrite here."},
        )
        self.assertEqual(request(self.base + "/health")[1]["modelState"], "loaded")

    def test_reading_health_never_loads_the_model(self):
        request(self.base + "/health")
        self.assertFalse(self.model.loaded)


class PreloadTest(unittest.TestCase):
    def test_an_installed_model_is_loaded_before_readiness(self):
        model = FakeHumanizer()
        with redirect_stdout(io.StringIO()):
            self.assertTrue(preload_model(model))
        self.assertTrue(model.loaded)

    def test_absent_weights_remain_an_optional_health_state(self):
        model = FakeHumanizer(installed=False)
        with redirect_stdout(io.StringIO()):
            self.assertFalse(preload_model(model))
        self.assertFalse(model.loaded)


class NotInstalledTest(ServerTestCase):
    model_kwargs = {"installed": False}

    def test_health_says_not_installed(self):
        body = request(self.base + "/health")[1]
        self.assertEqual(body["modelState"], "not_installed")
        # Not degraded: the service is fine, it just has nothing to run.
        self.assertEqual(body["status"], "ok")


class RewriteTest(ServerTestCase):
    def test_the_acceptance_fixture_comes_back_with_its_literals_intact(self):
        status, body = request(
            self.base + "/humanize",
            method="POST",
            payload={"requestId": "req-1", "text": ACCEPTANCE_MARKDOWN},
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["status"], "complete")
        self.assertEqual(body["requestId"], "req-1")
        self.assertTrue(body["preservation"]["passed"])
        self.assertEqual(body["chunks"]["reverted"], 0)
        self.assertIn("18.5%", body["rewrittenText"])
        self.assertIn("https://example.com/releases/2.4", body["rewrittenText"])
        self.assertNotEqual(body["rewrittenText"], ACCEPTANCE_MARKDOWN)
        self.assertEqual(body["originalText"], ACCEPTANCE_MARKDOWN)
        self.assertEqual(body["modelRevision"], "main")

    def test_cancellation_stops_a_run_in_progress(self):
        request(self.base + "/cancel", method="POST", payload={"requestId": "req-2"})
        status, body = request(
            self.base + "/humanize",
            method="POST",
            payload={"requestId": "req-2", "text": ACCEPTANCE_MARKDOWN},
        )
        self.assertEqual(status, 499)
        self.assertEqual(body["error"], "humanizer_cancelled")

    def test_a_cancelled_id_does_not_poison_the_next_request(self):
        request(self.base + "/cancel", method="POST", payload={"requestId": "req-3"})
        request(
            self.base + "/humanize",
            method="POST",
            payload={"requestId": "req-3", "text": ACCEPTANCE_MARKDOWN},
        )
        status, _ = request(
            self.base + "/humanize",
            method="POST",
            payload={"requestId": "req-3", "text": ACCEPTANCE_MARKDOWN},
        )
        self.assertEqual(status, 200)


class BusyTest(ServerTestCase):
    def test_a_second_rewrite_is_told_it_is_busy(self):
        release = threading.Event()
        entered = threading.Event()

        def slow(text):
            entered.set()
            release.wait(10)
            return text + " (rewritten)"

        self.model._transform = slow
        answers = {}

        def first():
            answers["first"] = request(
                self.base + "/humanize",
                method="POST",
                payload={"requestId": "slow", "text": "Some ordinary prose to rewrite."},
            )

        worker = threading.Thread(target=first, daemon=True)
        worker.start()
        self.assertTrue(entered.wait(10))
        status, body = request(
            self.base + "/humanize",
            method="POST",
            payload={"requestId": "second", "text": "Other ordinary prose to rewrite."},
        )
        self.assertEqual(status, 503)
        self.assertEqual(body["error"], "humanizer_busy")
        self.assertTrue(request(self.base + "/health")[1]["busy"])
        release.set()
        worker.join(10)
        self.assertEqual(answers["first"][0], 200)


class NotInstalledRewriteTest(ServerTestCase):
    model_kwargs = {"installed": False}

    def test_rewriting_without_the_checkpoint_is_a_structured_refusal(self):
        def refuse(_text):
            raise model_module.ModelNotInstalledError("not downloaded")

        self.model._transform = refuse
        status, body = request(
            self.base + "/humanize",
            method="POST",
            payload={"requestId": "r", "text": "Some ordinary prose to rewrite here."},
        )
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "humanizer_model_not_installed")


class LogHygieneTest(ServerTestCase):
    def test_no_line_of_user_text_reaches_stdout(self):
        request(
            self.base + "/humanize",
            method="POST",
            payload={"requestId": "logged", "text": ACCEPTANCE_MARKDOWN},
        )
        request(self.base + "/cancel", method="POST", payload={"requestId": "logged"})
        logs = self.stdout.getvalue()
        self.assertIn("logged", logs)
        self.assertIn("chunks=", logs)
        for secret_ish in (
            "Pivotal",
            "groundbreaking",
            "18.5%",
            "example.com",
            "npm run build",
            "quoted statement",
            SECRET,
        ):
            with self.subTest(fragment=secret_ish):
                self.assertNotIn(secret_ish, logs)


class DeviceTest(unittest.TestCase):
    """Device selection, without a GPU and without loading anything."""

    class _Torch:
        class cuda:  # noqa: N801 - mirrors torch's own shape
            available = False

            @classmethod
            def is_available(cls):
                return cls.available

    def _with_torch(self, available):
        import sys
        from unittest import mock

        torch = self._Torch()
        torch.cuda.available = available
        torch.float16 = "float16"
        torch.float32 = "float32"
        return mock.patch.dict(sys.modules, {"torch": torch})

    def test_auto_falls_back_to_cpu_float32(self):
        with self._with_torch(False):
            self.assertEqual(resolve_device("auto"), ("cpu", "float32"))

    def test_auto_prefers_cuda_float16(self):
        with self._with_torch(True):
            self.assertEqual(resolve_device("auto"), ("cuda:0", "float16"))

    def test_explicit_cpu_stays_on_the_cpu_even_with_a_card(self):
        with self._with_torch(True):
            self.assertEqual(resolve_device("cpu"), ("cpu", "float32"))

    def test_explicit_cuda_fails_loudly_rather_than_switching(self):
        with self._with_torch(False):
            with self.assertRaises(ModelError):
                resolve_device("cuda")


class GenerationBudgetTest(unittest.TestCase):
    def test_the_budget_is_bounded_at_both_ends(self):
        self.assertEqual(generation_budget(0), 32)
        self.assertEqual(generation_budget(10_000), 256)
        self.assertGreater(generation_budget(100), generation_budget(20))


class IdleUnloadTest(unittest.TestCase):
    def test_the_timer_drops_the_weights(self):
        humanizer = model_module.BartHumanizer(idle_seconds=0.05)
        # Stand in for a load without importing torch or touching the network.
        humanizer._model = object()
        humanizer._tokenizer = object()
        humanizer._touch()
        self.assertTrue(humanizer.loaded)
        humanizer._timer.join(5)
        self.assertFalse(humanizer.loaded)

    def test_an_idle_timeout_of_zero_keeps_the_model_resident(self):
        humanizer = model_module.BartHumanizer(idle_seconds=0)
        humanizer._model = object()
        humanizer._touch()
        self.assertIsNone(humanizer._timer)
        self.assertTrue(humanizer.loaded)


class InstalledProbeTest(unittest.TestCase):
    def test_a_missing_cache_reads_as_not_installed(self):
        import os
        from unittest import mock

        with mock.patch.dict(os.environ, {"HF_HUB_CACHE": os.path.join(os.sep, "nope")}):
            self.assertFalse(model_module.model_is_installed("cive202/humanize-ai-text-bart-large"))

    def test_a_snapshot_with_a_config_reads_as_installed(self):
        import os
        import tempfile
        from unittest import mock

        with tempfile.TemporaryDirectory() as cache:
            snapshot = os.path.join(
                cache, "models--cive202--humanize-ai-text-bart-large", "snapshots", "abc123"
            )
            os.makedirs(snapshot)
            with open(os.path.join(snapshot, "config.json"), "w", encoding="utf-8") as handle:
                handle.write("{}")
            with mock.patch.dict(os.environ, {"HF_HUB_CACHE": cache}):
                self.assertTrue(
                    model_module.model_is_installed("cive202/humanize-ai-text-bart-large")
                )


if __name__ == "__main__":
    unittest.main()
