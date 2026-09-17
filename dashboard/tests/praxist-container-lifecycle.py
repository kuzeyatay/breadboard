"""Exercise finalization ordering with a real, short-lived child process."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location("container_runner", sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

with tempfile.TemporaryDirectory() as temporary:
    workspace = Path(temporary)
    script = """
import json, pathlib, sys, time
root = pathlib.Path(sys.argv[1]) / 'research-run'
root.mkdir()
(root / 'run.json').write_text(json.dumps({'status':'running'}))
(root / 'run_summary.json').write_text(json.dumps({'status':'succeeded'}))
time.sleep(0.2)
(root / 'published-test-artifact.txt').write_text('Published after the early summary')
(root / 'run.json').write_text(json.dumps({'status':'succeeded','finalized_at':'2026-09-08T00:00:00Z'}))
"""
    child = subprocess.Popen([sys.executable, "-c", script, temporary])
    try:
        metadata = runner.wait_for_finalization(workspace, child.pid, 5, 0.02, lambda _: child.poll() is None)
        assert child.wait() == 0
        assert metadata["status"] == "succeeded"
        assert (workspace / "research-run" / "published-test-artifact.txt").exists()
    finally:
        if child.poll() is None:
            child.terminate()
            child.wait()

    (workspace / "research-run" / "run.json").write_text(json.dumps({"status":"running"}))
    try:
        runner.wait_for_finalization(workspace, -1, 1, 0.02, lambda _: False)
        raise AssertionError("Unfinalized process exit must fail")
    except RuntimeError as error:
        assert "before publishing" in str(error)
print("Real child process finalization ordering passed")
