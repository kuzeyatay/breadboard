"""First-use provisioning without downloading weights or loading torch."""
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from breadboard_humanizer import DEFAULT_MODEL_ID, DEFAULT_MODEL_REVISION
from breadboard_humanizer.model import (
    MODEL_FILES, ModelError, ensure_model_installed, installed_model_cache,
)


class InstallationTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.home = Path(directory.name)
        self.cache = self.home / "current" / "hub"
        self.patch = patch.dict(os.environ, {"HF_HUB_CACHE": str(self.cache)})
        self.patch.start()
        self.addCleanup(self.patch.stop)
        home_patch = patch("os.path.expanduser", return_value=str(self.home))
        home_patch.start()
        self.addCleanup(home_patch.stop)

    def populate(self, cache):
        snapshot = cache / "models--cive202--humanize-ai-text-bart-large" / "snapshots" / DEFAULT_MODEL_REVISION
        snapshot.mkdir(parents=True, exist_ok=True)
        for name in MODEL_FILES:
            (snapshot / name).write_bytes(b"fixture")
        return snapshot

    def test_reuses_legacy_install_without_network_or_copy(self):
        legacy = self.home / ".breadboard" / "humanizer" / "models" / "hub"
        self.populate(legacy)
        with patch("breadboard_humanizer.model.urlopen") as download:
            self.assertEqual(ensure_model_installed(DEFAULT_MODEL_ID, DEFAULT_MODEL_REVISION), str(legacy))
            download.assert_not_called()

    def test_current_cache_wins_and_probe_never_downloads(self):
        with patch("breadboard_humanizer.model.urlopen") as download:
            self.assertIsNone(installed_model_cache(DEFAULT_MODEL_ID))
            self.populate(self.cache)
            self.assertEqual(installed_model_cache(DEFAULT_MODEL_ID), str(self.cache))
            download.assert_not_called()

    def test_first_use_downloads_pinned_data_files_and_next_use_is_offline(self):
        def response(*args, **kwargs):
            result = io.BytesIO(b"fixture")
            result.headers = {"Content-Length": "7"}
            return result
        with patch("breadboard_humanizer.model.urlopen", side_effect=response) as download:
            self.assertEqual(ensure_model_installed(DEFAULT_MODEL_ID, DEFAULT_MODEL_REVISION), str(self.cache))
            self.assertEqual(download.call_count, len(MODEL_FILES))
            for call in download.call_args_list:
                self.assertIn(f"/resolve/{DEFAULT_MODEL_REVISION}/", call.args[0])
                self.assertNotIn(".bin", call.args[0])
            ensure_model_installed(DEFAULT_MODEL_ID, DEFAULT_MODEL_REVISION)
            self.assertEqual(download.call_count, len(MODEL_FILES))

    def test_incomplete_download_never_becomes_installed_and_can_be_retried(self):
        response = io.BytesIO(b"short")
        response.headers = {"Content-Length": "100"}
        with patch("breadboard_humanizer.model.urlopen", return_value=response):
            with self.assertRaises(ModelError):
                ensure_model_installed(DEFAULT_MODEL_ID, DEFAULT_MODEL_REVISION)
        self.assertIsNone(installed_model_cache(DEFAULT_MODEL_ID))
        self.assertEqual(list(self.cache.rglob("*.partial")), [])

    def test_unpinned_download_is_rejected(self):
        with patch("breadboard_humanizer.model.urlopen") as download:
            with self.assertRaises(ModelError):
                ensure_model_installed(DEFAULT_MODEL_ID, "main")
            download.assert_not_called()
