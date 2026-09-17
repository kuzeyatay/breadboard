"""Disk preflight tests; no installer or download is invoked."""
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("acestep_setup", Path(__file__).resolve().parents[1] / "scripts" / "acestep-setup.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupSpaceTests(unittest.TestCase):
    def test_fresh_setup_rejects_low_space_without_network_or_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(setup.shutil, "disk_usage", return_value=types.SimpleNamespace(free=9 * 1024**3)), patch.object(setup.urllib.request, "urlopen") as download, patch.object(setup.subprocess, "run") as install:
                with self.assertRaisesRegex(RuntimeError, "30.0 GiB free required, 9.0 GiB available"):
                    setup.check_setup_space(root)
                download.assert_not_called()
                install.assert_not_called()
            self.assertEqual(list(root.iterdir()), [])

    def test_existing_files_count_toward_the_budget_but_staging_space_is_reserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "uv-cache").mkdir()
            (root / "uv-cache" / "fixture").write_bytes(b"cached")
            with patch.object(setup, "SETUP_SPACE_BYTES", 2 * 1024**3 + 6), patch.object(setup.shutil, "disk_usage", return_value=types.SimpleNamespace(free=2 * 1024**3)):
                setup.check_setup_space(root)
            with patch.object(setup, "SETUP_SPACE_BYTES", 1), patch.object(setup.shutil, "disk_usage", return_value=types.SimpleNamespace(free=1024**3)):
                with self.assertRaisesRegex(RuntimeError, "2.0 GiB free required"):
                    setup.check_setup_space(root)

    def test_preflight_precedes_the_first_download_in_main(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(setup.sys, "argv", ["acestep-setup.py", directory, "unused-uv"]), patch.object(setup.shutil, "disk_usage", return_value=types.SimpleNamespace(free=0)), patch.object(setup.urllib.request, "urlopen") as download, patch.object(setup.subprocess, "run") as install:
                with self.assertRaisesRegex(RuntimeError, "Insufficient disk space"):
                    setup.main()
                download.assert_not_called()
                install.assert_not_called()


if __name__ == "__main__":
    unittest.main()
