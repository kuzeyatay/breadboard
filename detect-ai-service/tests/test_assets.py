import json
import tempfile
import unittest
from pathlib import Path

from breadboard_detect_ai.assets import AssetStore


class AssetVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = AssetStore(Path(self.temporary.name) / "assets")

    def tearDown(self):
        self.temporary.cleanup()

    def test_invalid_checksum_manifest_is_quarantined(self):
        snapshot = Path(self.temporary.name) / "snapshot"
        snapshot.mkdir()
        (snapshot / "weights.safetensors").write_bytes(b"fixture")
        (snapshot / ".breadboard-sha256.json").write_text("{broken", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "manifest"):
            self.store._verify_or_record(snapshot, "owner/model", "revision", lambda *_: None)
        self.assertFalse(snapshot.exists())
        self.assertEqual(len(list(self.store.quarantine.iterdir())), 1)

    def test_changed_snapshot_file_is_quarantined(self):
        snapshot = Path(self.temporary.name) / "snapshot"
        snapshot.mkdir()
        weights = snapshot / "weights.safetensors"
        weights.write_bytes(b"changed")
        (snapshot / ".breadboard-sha256.json").write_text(
            json.dumps({"files": {"weights.safetensors": "0" * 64}}),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(RuntimeError, "checksum"):
            self.store._verify_or_record(snapshot, "owner/model", "revision", lambda *_: None)
        self.assertFalse(snapshot.exists())


if __name__ == "__main__":
    unittest.main()
