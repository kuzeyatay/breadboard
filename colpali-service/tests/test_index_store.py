"""Page vectors survive a round trip, ragged lengths and all."""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from breadboard_colpali.index_store import IndexStore


class IndexStoreTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = IndexStore(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def test_pages_of_different_lengths_come_back_intact(self):
        # The whole reason for the offset table: pages do not agree on how many
        # patches they produce, and padding them to the longest one would waste
        # the memory this store exists to bound.
        pages = [
            np.random.rand(37, 128).astype(np.float16),
            np.random.rand(1024, 128).astype(np.float16),
            np.random.rand(512, 128).astype(np.float16),
        ]
        self.store.write("doc_" + "a" * 32, "vidore/colSmol-500M", [1, 2, 3], pages)

        index = self.store.read("doc_" + "a" * 32)
        self.assertIsNotNone(index)
        self.assertEqual(index.page_numbers, [1, 2, 3])
        self.assertEqual(index.model_id, "vidore/colSmol-500M")
        self.assertEqual(index.dimensions, 128)
        for original, restored in zip(pages, index.vectors, strict=True):
            self.assertEqual(original.shape, restored.shape)
            np.testing.assert_array_equal(original, restored)

    def test_a_missing_document_reads_as_none(self):
        self.assertIsNone(self.store.read("doc_" + "b" * 32))
        self.assertFalse(self.store.exists("doc_" + "b" * 32))

    def test_an_id_that_is_a_path_cannot_escape_the_index_directory(self):
        # The server validates ids before they reach here; this is the second
        # lock on the same door, because the id becomes a filename.
        outside = Path(self.directory.name).parent / "escaped.npz"
        self.store.write("../escaped", "m", [1], [np.zeros((2, 4), dtype=np.float16)])
        self.assertFalse(outside.exists())
        self.assertTrue((Path(self.directory.name) / "escaped.npz").exists())

    def test_delete_reports_whether_there_was_anything_to_delete(self):
        self.store.write("doc_" + "c" * 32, "m", [1], [np.zeros((2, 4), dtype=np.float16)])
        self.assertTrue(self.store.delete("doc_" + "c" * 32))
        self.assertFalse(self.store.delete("doc_" + "c" * 32))

    def test_counting_ignores_anything_that_is_not_an_index(self):
        (Path(self.directory.name) / "stray.tmp").write_bytes(b"")
        self.store.write("doc_" + "d" * 32, "m", [1], [np.zeros((2, 4), dtype=np.float16)])
        self.assertEqual(self.store.count(), 1)


if __name__ == "__main__":
    unittest.main()
