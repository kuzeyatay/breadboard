"""Verify setup records the model code that the pinned runtime will actually use."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(os.environ.get("BREADBOARD_TEST_REPO", Path(__file__).resolve().parents[2]))
SOURCE = Path(os.environ.get("BREADBOARD_TEST_CANDIDATE", ROOT))
UPSTREAM = Path(os.environ["BREADBOARD_TEST_ACESTEP_SOURCE"]) if os.environ.get("BREADBOARD_TEST_ACESTEP_SOURCE") else None


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@unittest.skipUnless(UPSTREAM and (UPSTREAM / "acestep/model_downloader.py").is_file(), "Set BREADBOARD_TEST_ACESTEP_SOURCE to the prepared pinned runtime")
class PreparedCodeTests(unittest.TestCase):
    def test_readiness_records_the_runtime_code_after_pinned_model_download(self):
        with tempfile.TemporaryDirectory(prefix="owned-acestep-code-") as folder:
            root = Path(folder).resolve()
            state = root / "state"
            state.mkdir()
            checkpoint = root / "source/checkpoints"
            weights = ["acestep-v15-turbo/model.safetensors", "vae/diffusion_pytorch_model.safetensors", "Qwen3-Embedding-0.6B/model.safetensors"]
            inventory = types.SimpleNamespace(siblings=[types.SimpleNamespace(rfilename=name, size=7) for name in weights])
            downloads = []

            def snapshot_download(**kwargs):
                self.assertEqual(kwargs["local_dir"], str(checkpoint))
                downloads.append(kwargs)
                for name in weights:
                    file = checkpoint / name
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_bytes(b"fixture")
                # The fixed model revision's code can differ from the separately
                # pinned program revision, as observed on the installed runtime.
                for file in (UPSTREAM / "acestep/models/turbo").glob("*.py"):
                    if file.name != "__init__.py":
                        (checkpoint / "acestep-v15-turbo" / file.name).write_text("# older checkpoint code\n")

            hub = types.ModuleType("huggingface_hub")
            hub.HfApi = lambda: types.SimpleNamespace(model_info=lambda *args, **kwargs: inventory)
            hub.snapshot_download = snapshot_download
            package = types.ModuleType("acestep")
            package.__path__ = [str(UPSTREAM / "acestep")]
            torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False), backends=types.SimpleNamespace())
            old_path = list(sys.path)
            try:
                with patch.dict(sys.modules, {"huggingface_hub": hub, "torch": torch, "acestep": package}):
                    downloader = load("acestep.model_downloader", UPSTREAM / "acestep/model_downloader.py")
                    setup = load("owned_acestep_setup", SOURCE / "dashboard/scripts/acestep-setup.py")
                    setup.models(root, state)
                    self.assertEqual(len(downloads), 1)
                    self.assertEqual(downloader._check_code_mismatch("acestep-v15-turbo", checkpoint), [])
                    manifest = json.loads((state / "models-ready.json").read_text())
                    code_files = [item for item in manifest["files"] if item["path"].endswith(".py")]
                    self.assertGreaterEqual(len(code_files), 2)
                    for item in code_files:
                        recorded = root / item["path"]
                        pinned = UPSTREAM / "acestep/models/turbo" / recorded.name
                        self.assertEqual(recorded.read_bytes(), pinned.read_bytes())
                        self.assertEqual(item["size"], pinned.stat().st_size)
            finally:
                sys.path[:] = old_path


if __name__ == "__main__":
    unittest.main()
