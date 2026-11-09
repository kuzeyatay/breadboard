"""Exercise the real pinned model precheck through the managed entrypoint.

No model is loaded, downloaded or served. The tiny isolated fixture contains the
same three model components as managed setup; the optional planning LM is absent.
"""
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
class PreparedStartupTests(unittest.TestCase):
    def exercise_startup(self, *, empty_component=None):
        with tempfile.TemporaryDirectory(prefix="owned-acestep-precheck-") as folder:
            root = Path(folder).resolve()
            source = root / "source"
            checkpoint = source / "checkpoints"
            files = []
            for name, weight in (("acestep-v15-turbo", "model.safetensors"),
                                 ("vae", "diffusion_pytorch_model.safetensors"),
                                 ("Qwen3-Embedding-0.6B", "model.safetensors")):
                model = checkpoint / name
                model.mkdir(parents=True)
                # A directory/config alone must never count as model readiness.
                file = model / ("config.json" if empty_component == name else weight)
                file.write_bytes(b"fixture")
                files.append({"path": file.relative_to(root).as_posix(), "size": file.stat().st_size})
            (root / "models-ready.json").write_text(json.dumps({"sourceRevision": "ca1e85fe9430179831e6bc6be790c332190a3866", "files": files}))
            (root / "api-key").write_text("owned-test-token")
            package = types.ModuleType("acestep")
            package.__path__ = [str(UPSTREAM / "acestep")]
            api = types.ModuleType("acestep.api")
            api.__path__ = [str(UPSTREAM / "acestep/api")]
            server = types.ModuleType("acestep.api_server")
            server.app = object()
            state = {"served": False, "optionalDenied": False}

            def serve(app, *, host, port):
                self.assertIs(app, server.app)
                self.assertEqual((host, port), ("127.0.0.1", 56789))
                self.assertEqual(os.environ["ACESTEP_INIT_LLM"], "false")
                precheck = load("owned_acestep_precheck", UPSTREAM / "acestep/core/generation/handler/init_service_downloads.py")
                result = precheck.InitServiceDownloadsMixin()._ensure_models_present(
                    checkpoint_path=checkpoint, config_path="acestep-v15-turbo", prefer_source=None)
                self.assertIsNone(result)
                self.assertFalse((checkpoint / "acestep-5Hz-lm-1.7B").exists())
                with self.assertRaisesRegex(RuntimeError, "automatic downloads are disabled"):
                    api.model_download.ensure_model_downloaded("acestep-5Hz-lm-1.7B", str(checkpoint))
                with self.assertRaisesRegex(RuntimeError, "explicit Music Producer setup"):
                    package.model_downloader.download_main_model(checkpoint)
                state.update(served=True, optionalDenied=True)

            old_cwd = Path.cwd()
            old_path = list(sys.path)
            try:
                # Actual upstream checker and helper imports; only the server and
                # download library are replaced so the test cannot use a network.
                with patch.dict(sys.modules, {"acestep": package, "acestep.api": api,
                                              "acestep.api_server": server,
                                              "uvicorn": types.SimpleNamespace(run=serve),
                                              "huggingface_hub": types.ModuleType("huggingface_hub")}):
                    package.model_downloader = load("acestep.model_downloader", UPSTREAM / "acestep/model_downloader.py")
                    api.model_download = load("acestep.api.model_download", UPSTREAM / "acestep/api/model_download.py")
                    entry = load("owned_acestep_entry", SOURCE / "dashboard/scripts/acestep-managed-service.py")
                    with patch.dict(os.environ, {"BREADBOARD_ACESTEP_DIR": str(root),
                                                 "BREADBOARD_ACESTEP_SOURCE_DIR": str(source),
                                                 "BREADBOARD_ACESTEP_PORT": "56789"}):
                        entry.main()
                return state
            finally:
                os.chdir(old_cwd)
                sys.path[:] = old_path

    def test_prepared_audio_components_start_without_optional_planning_lm(self):
        self.assertEqual(self.exercise_startup(), {"served": True, "optionalDenied": True})

    def test_empty_text_encoder_is_still_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "explicit Music Producer setup"):
            self.exercise_startup(empty_component="Qwen3-Embedding-0.6B")

    def test_empty_audio_model_is_still_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "explicit Music Producer setup"):
            self.exercise_startup(empty_component="acestep-v15-turbo")


if __name__ == "__main__":
    unittest.main()
