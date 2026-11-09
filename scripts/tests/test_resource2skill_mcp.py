"""Exercise child provider wiring and real local Chromium without a model."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = Path(os.environ.get("BREADBOARD_TEST_REPO", Path(__file__).resolve().parents[2]))
SOURCE = Path(os.environ.get("BREADBOARD_TEST_CANDIDATE", ROOT))


def bridge_module():
    spec = importlib.util.spec_from_file_location("r2s_bridge_test", SOURCE / "scripts/resource2skill-bridge.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ChildEnvironmentTests(unittest.TestCase):
    def test_managed_paths_and_provider_survive_mcp_whitelist(self):
        bridge = bridge_module()
        config = {"mcp": {"command": "python", "args": ["domains/web/mcp_server/server.py"], "env": {"DOMAIN_OPTION": "kept"}}}
        env = {"CHATMOCK_BASE_URL": "http://127.0.0.1:9/v1", "CHATMOCK_MODEL": "configured-model",
               "CHATMOCK_API_KEY": "owned-fixture-secret", "PLAYWRIGHT_BROWSERS_PATH": "D:/owned browser cache",
               "TEMP": "C:/owned temp", "TMP": "C:/owned temp", "PYTHONUTF8": "1", "UNRELATED_SECRET": "excluded"}
        with patch.dict(os.environ, env, clear=True):
            result = bridge.configure_output(config, "web", Path("C:/owned output"))
        child = result["mcp"]
        for key, value in env.items():
            if key != "UNRELATED_SECRET":
                self.assertEqual(child["env"].get(key), value, key)
        self.assertNotIn("UNRELATED_SECRET", child["env"])
        self.assertEqual(child["env"]["DOMAIN_OPTION"], "kept")
        self.assertIn("--mcp-server", child["args"])
        self.assertNotIn(env["CHATMOCK_API_KEY"], " ".join(child["args"]))
        self.assertEqual(config["mcp"]["args"], ["domains/web/mcp_server/server.py"])

    def test_real_child_uses_configured_model_and_keeps_stdout_as_jsonrpc(self):
        bridge = bridge_module()
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                requests.append({"path": self.path, "body": json.loads(self.rfile.read(int(self.headers["content-length"])))})
                data = json.dumps({"choices": [{"message": {"role": "assistant", "content": "owned-answer"}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory(prefix="r2s mcp owned ") as directory:
                root = Path(directory)
                (root / "core").mkdir()
                (root / "core/__init__.py").write_text("")
                (root / "core/llm.py").write_text("def call_azure_openai(*args, **kwargs): raise RuntimeError('unpatched Azure provider')\n")
                entry = root / "server.py"
                entry.write_text("from core.llm import call_azure_openai\nimport json,sys\nresult=call_azure_openai([{'role':'user','content':'owned'}],model='upstream-default')\nprint(json.dumps({'jsonrpc':'2.0','id':1,'result':{'answer':result['content'],'args':sys.argv[1:]}}))\n")
                with patch.dict(os.environ, {"CHATMOCK_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1", "CHATMOCK_API_KEY": "fixture", "CHATMOCK_MODEL": "configured-model"}):
                    config = bridge.configure_output({"mcp": {"args": [str(entry), "--fixture", "owned"]}}, "ppt", root)
                    result = subprocess.run([config["mcp"]["command"], *config["mcp"]["args"]], cwd=root,
                                            env={**os.environ, **config["mcp"].get("env", {})}, capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr)
                messages = [json.loads(line) for line in result.stdout.splitlines() if line]
                self.assertEqual(len(messages), 1, "Breadboard model events must not corrupt MCP stdout")
                self.assertEqual(messages[0]["result"], {"answer": "owned-answer", "args": ["--fixture", "owned"]})
                self.assertEqual(requests[0]["path"], "/v1/chat/completions")
                self.assertEqual(requests[0]["body"]["model"], "configured-model")
        finally:
            server.shutdown()
            server.server_close()
            worker.join(5)


class NativePageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        original = ROOT / "Resource2Skill/domains/web/mcp_server/server.py"
        source = SOURCE / "Resource2Skill/domains/web/mcp_server/server.py"
        cls.module = types.ModuleType("resource2skill_web_native_test")
        cls.module.__file__ = str(original)
        sys.modules[cls.module.__name__] = cls.module
        exec(compile(source.read_text(encoding="utf-8"), str(source), "exec"), cls.module.__dict__)

    def check_page(self, inspect):
        with tempfile.TemporaryDirectory(prefix="r2s page # ü ") as directory:
            project = Path(directory)
            (project / "index.html").write_text('<!doctype html><title>Owned page</title><section><h1>Owned render</h1><p>5 gives 15.</p></section>', encoding="utf-8")
            self.module._projects["owned-native"] = {"dir": project, "name": "owned"}
            try:
                if inspect:
                    inspected = self.module.inspect_dom("owned-native")
                    self.assertTrue(inspected.startswith("DOM:"), inspected)
                    self.assertIn("Console errors: 0", inspected)
                    self.assertIn("section", inspected)
                else:
                    rendered = self.module.render_page("owned-native", 400, 240)
                    self.assertTrue(rendered.startswith("Rendered:"), rendered)
                    self.assertGreater((project / "_renders/preview.png").stat().st_size, 200)
            finally:
                self.module._projects.pop("owned-native", None)

    def test_local_page_with_space_hash_and_unicode_renders(self):
        self.check_page(False)

    def test_dom_uses_owned_project_temp_on_windows(self):
        self.check_page(True)


if __name__ == "__main__":
    unittest.main()
