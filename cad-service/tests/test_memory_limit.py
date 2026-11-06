"""Exercise the OS boundary with a small limit, without loading the CAD kernel."""
import os
from pathlib import Path
import subprocess
import sys
import unittest
import json
import tempfile
from unittest.mock import patch


@unittest.skipUnless(sys.platform == "win32", "Windows Job Object boundary")
class MemoryLimitTests(unittest.TestCase):
    def test_worker_refuses_execution_when_limit_cannot_be_established(self):
        from breadboard_cad.worker import main
        with tempfile.TemporaryDirectory() as directory:
            job, result = Path(directory)/"job.json", Path(directory)/"result.json"
            job.write_text(json.dumps({"source": "def build_model(params): return {}", "parameters": {}}))
            with patch("breadboard_cad.worker.apply_worker_memory_limit", side_effect=OSError("refused")), patch("breadboard_cad.worker.run_job") as execute:
                self.assertEqual(main(["worker", str(job), str(result)]), 0)
                execute.assert_not_called()
            self.assertEqual(json.loads(result.read_text())["failure"]["code"], "memory_limit_unavailable")

    def test_allocation_above_commit_limit_is_refused(self):
        script = """
from breadboard_cad.memory_limit import apply_worker_memory_limit
apply_worker_memory_limit(128 * 1024**2)
try:
    allocation = bytearray(256 * 1024**2)
except MemoryError:
    print('allocation refused')
else:
    raise AssertionError('Windows did not enforce the commit limit')
"""
        environment = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=15, env=environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("allocation refused", result.stdout)


if __name__ == "__main__":
    unittest.main()
