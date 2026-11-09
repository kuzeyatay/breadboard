"""Run the bundled npm wrappers through their actual managed Windows paths."""
import os
from pathlib import Path
import platform
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(os.environ.get("BREADBOARD_TEST_REPO", Path(__file__).resolve().parents[2]))
SOURCE = Path(os.environ.get("BREADBOARD_TEST_CANDIDATE", ROOT))


@unittest.skipUnless(platform.system() == "Windows", "Real Windows command-shim regression")
class ManagedNodeCommands(unittest.TestCase):
    def test_npm_and_npx_launch_from_extended_runtime_path(self):
        source = SOURCE / "openmontage/tools/base_tool.py"
        module = types.ModuleType("owned_openmontage_base")
        module.__file__ = str(ROOT / "openmontage/tools/base_tool.py")
        sys.modules[module.__name__] = module
        exec(compile(source.read_text(encoding="utf-8"), str(source), "exec"), module.__dict__)
        node_dir = ROOT / "desktop/build-resources/runtimes/node"
        self.assertTrue((node_dir / "node.exe").is_file())
        with patch.dict(os.environ, {"PATH":"\\\\?\\" + str(node_dir) + os.pathsep + str(Path(os.environ["SystemRoot"]) / "System32")}):
            for command in ("npm", "npx"):
                with self.subTest(command=command):
                    result = module.BaseTool.run_command(object(), [command, "--version"], timeout=20, cwd=ROOT)
                    self.assertRegex(result.stdout.strip(), r"^\d+\.\d+\.\d+$")
                    self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
