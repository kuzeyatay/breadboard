"""The loopback HTTP surface: authentication, validation, and the retrieval path.

The model is stubbed. Loading a gigabyte of weights to prove that `/search`
sorts by score would test PyTorch, not this service — and it would make the
suite unrunnable on any machine that has not done the 3.5 GB setup. What is
worth pinning here is everything around the model: that an unauthenticated
caller gets nothing, that a document id which is really a path is refused, that
a query against an index written by a different checkpoint fails loudly instead
of scoring across two incompatible spaces, and that pages come back ranked.
"""

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import numpy as np

from breadboard_colpali.index_store import IndexStore
from breadboard_colpali.server import _Handler

SECRET = "test-secret-value"
DOCUMENT = "doc_" + "0" * 32


class StubEmbedder:
    """Answers like the real one without owning a card."""

    def __init__(self, model_id="vidore/colSmol-500M"):
        self.model_id = model_id
        self.device = "cpu"
        self.dtype = "float32"
        self.loaded = False
        self.load_error = ""
        self.scored = []

    def probe(self):
        return {"torch": "2.6.0", "cuda": "12.4", "device": "cpu"}

    def embed_pages(self, images):
        return [np.full((4, 8), index + 1, dtype=np.float16) for index in range(len(images))]

    def score(self, query, page_vectors):
        self.scored.append(query)
        # Deliberately not monotonic in page order, so a handler that forgot to
        # sort would be caught rather than accidentally right.
        return [0.1, 0.9, 0.5][: len(page_vectors)]


def request(url, *, method="GET", token=SECRET, payload=None):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json", "Connection": "close"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    call = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(call, timeout=120) as response:  # noqa: S310 - loopback only
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8") or "{}")


def one_pixel_png_base64():
    # A real PNG, so decode_page_image is exercised rather than mocked out.
    import base64
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (255, 0, 0)).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.embedder = StubEmbedder()
        handler = type(
            "_TestHandler",
            (_Handler,),
            {
                "secret": SECRET,
                "embedder": cls.embedder,
                "store": IndexStore(cls.directory.name),
            },
        )
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.httpd.daemon_threads = True
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.directory.cleanup()

    def test_every_route_requires_the_shared_secret(self):
        self.assertEqual(request(f"{self.base}/health", token=None)[0], 401)
        self.assertEqual(request(f"{self.base}/health", token="wrong")[0], 401)
        self.assertEqual(
            request(f"{self.base}/search", method="POST", token=None, payload={})[0], 401
        )
        self.assertEqual(
            request(f"{self.base}/index/{DOCUMENT}", method="DELETE", token=None)[0], 401
        )

    def test_health_reports_the_model_without_loading_it(self):
        status, body = request(f"{self.base}/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["modelId"], "vidore/colSmol-500M")
        self.assertFalse(body["modelLoaded"])
        self.assertEqual(body["torchVersion"], "2.6.0")

    def test_a_document_id_that_is_really_a_path_is_refused(self):
        status, body = request(
            f"{self.base}/search",
            method="POST",
            payload={"documentId": "../../etc/passwd", "query": "x"},
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"], "invalid_request")

    def test_searching_a_document_that_was_never_indexed_says_so(self):
        status, body = request(
            f"{self.base}/search",
            method="POST",
            payload={"documentId": "doc_" + "f" * 32, "query": "anything"},
        )
        self.assertEqual(status, 404)
        self.assertEqual(body["error"], "not_indexed")

    def test_index_then_search_returns_pages_ranked_by_score(self):
        page = one_pixel_png_base64()
        status, body = request(
            f"{self.base}/index",
            method="POST",
            payload={
                "documentId": DOCUMENT,
                "pages": [
                    {"pageNumber": 1, "imageBase64": page},
                    {"pageNumber": 2, "imageBase64": page},
                    {"pageNumber": 3, "imageBase64": page},
                ],
            },
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["pages"], 3)
        self.assertEqual(body["dimensions"], 8)
        self.assertFalse(body["truncated"])

        status, body = request(
            f"{self.base}/search",
            method="POST",
            payload={"documentId": DOCUMENT, "query": "where is the chart", "topK": 2},
        )
        self.assertEqual(status, 200, body)
        # Stub scores are [0.1, 0.9, 0.5] for pages 1, 2, 3.
        self.assertEqual([entry["pageNumber"] for entry in body["pages"]], [2, 3])
        self.assertIn("where is the chart", self.embedder.scored)

    def test_an_index_from_another_checkpoint_is_refused_rather_than_scored(self):
        # Two checkpoints embed into different spaces. Scoring across them
        # returns numbers, which is worse than returning an error.
        store = IndexStore(self.directory.name)
        stale = "doc_" + "e" * 32
        store.write(stale, "vidore/colqwen2-v1.0", [1], [np.zeros((4, 8), dtype=np.float16)])
        status, body = request(
            f"{self.base}/search",
            method="POST",
            payload={"documentId": stale, "query": "x"},
        )
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "stale_index")

    def test_an_unknown_route_is_not_found(self):
        self.assertEqual(request(f"{self.base}/embeddings")[0], 404)


if __name__ == "__main__":
    unittest.main()
