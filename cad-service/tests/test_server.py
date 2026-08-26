"""The loopback HTTP surface: authentication, refusals, and one real build."""

import base64
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from breadboard_cad.server import _Handler, _kernel_probe, _reset_kernel_probe_cache

SECRET = "test-secret-value"

BOX = """
import cadquery as cq

def build_model(params):
    return {"block": cq.Workplane("XY").box(20.0, 10.0, 5.0)}
"""


def request(url, *, method="GET", token=SECRET, payload=None):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    # The service speaks HTTP/1.1, so a connection would otherwise stay open
    # until urllib's socket is collected — and a keep-alive socket still open
    # when `shutdown()` runs makes the teardown race on Windows.
    headers = {"Content-Type": "application/json", "Connection": "close"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    call = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(call, timeout=300) as response:  # noqa: S310 - loopback only
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8") or "{}")


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = type("_TestHandler", (_Handler,), {"secret": SECRET, "workspace_root": None})
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.httpd.daemon_threads = True
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def test_health_requires_the_shared_secret(self):
        self.assertEqual(request(f"{self.base}/health", token=None)[0], 401)
        self.assertEqual(request(f"{self.base}/health", token="wrong")[0], 401)

    def test_health_reports_the_kernel(self):
        status, body = request(f"{self.base}/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok", body.get("detail"))
        self.assertTrue(body["cadqueryVersion"])
        self.assertTrue(body["ocpVersion"])
        self.assertTrue(body["pythonVersion"].startswith("3."))
        self.assertEqual(set(body["exportFormats"]), {"step", "stl", "glb", "3mf"})
        self.assertEqual(body["engines"], ["cadquery"])

    def test_kernel_probe_rejects_a_native_crash_after_valid_output(self):
        completed = type(
            "Completed",
            (),
            {
                "returncode": -1073741819,
                "stdout": b'{"python":"3.12.10","cadquery":"2.6.0"}',
                "stderr": b"",
            },
        )()
        _reset_kernel_probe_cache()
        try:
            with patch("breadboard_cad.server.subprocess.run", return_value=completed):
                probe = _kernel_probe()
        finally:
            _reset_kernel_probe_cache()
        self.assertIn("exited with code", probe["error"])

    def test_kernel_probe_caches_a_successful_immutable_runtime(self):
        completed = type(
            "Completed",
            (),
            {
                "returncode": 0,
                "stdout": b'{"python":"3.12.10","cadquery":"2.6.0","ocp":"7.8.1.1.post1"}',
                "stderr": b"",
            },
        )()
        _reset_kernel_probe_cache()
        try:
            with patch(
                "breadboard_cad.server.subprocess.run", return_value=completed
            ) as run:
                self.assertEqual(_kernel_probe()["cadquery"], "2.6.0")
                self.assertEqual(_kernel_probe()["cadquery"], "2.6.0")
                run.assert_called_once()
        finally:
            _reset_kernel_probe_cache()

    def test_execute_requires_the_shared_secret(self):
        status, _ = request(f"{self.base}/execute", method="POST", token=None, payload={"source": BOX})
        self.assertEqual(status, 401)

    def test_unknown_routes_are_not_found(self):
        self.assertEqual(request(f"{self.base}/whatever")[0], 404)
        self.assertEqual(request(f"{self.base}/whatever", method="POST", payload={})[0], 404)

    def test_a_malformed_request_is_a_typed_refusal(self):
        status, body = request(f"{self.base}/execute", method="POST", payload={"nope": 1})
        self.assertEqual(status, 422)
        self.assertEqual(body["error"], "invalid_request")

    def test_execute_builds_and_returns_the_export_bytes(self):
        status, body = request(
            f"{self.base}/execute",
            method="POST",
            payload={
                "source": BOX,
                "timeoutMs": 120_000,
                "exports": [
                    {"format": "step", "filename": "model.step"},
                    {"format": "stl", "filename": "model.stl"},
                ],
                "expectations": {"expectedSolidCount": 1, "boundingBox": {"x": 20, "y": 10, "z": 5}},
            },
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"], body.get("failure"))
        self.assertEqual(body["solidCount"], 1)
        self.assertAlmostEqual(body["volume"], 1_000.0, places=3)
        self.assertFalse([i for i in body["issues"] if i["severity"] == "error"])
        step = base64.b64decode(body["files"]["step"])
        self.assertIn(b"ISO-10303-21", step)
        self.assertGreater(len(base64.b64decode(body["files"]["stl"])), 84)


if __name__ == "__main__":
    unittest.main()
