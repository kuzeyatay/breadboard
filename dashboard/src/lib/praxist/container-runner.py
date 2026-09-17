"""Keep one normal Praxist CLI run alive inside its owned Linux container."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path("/work")
run_id = None
completed = False


def stop(*_args):
    if run_id:
        try:
            subprocess.run([sys.executable, "-m", "praxist", "stop", run_id, "--grace", "10"], timeout=25, check=False)
        except (OSError, subprocess.TimeoutExpired):
            pass
    raise SystemExit(0)


def process_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # Detached children are reaped by container init. Do not wait on a zombie.
    stat = Path(f"/proc/{pid}/stat")
    try:
        return stat.read_text().rsplit(")", 1)[1].split()[0] != "Z"
    except FileNotFoundError:
        return False


def wait_for_finalization(workspace, pid, timeout_seconds=45 * 60, poll_seconds=2, is_alive=process_alive):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if not is_alive(pid):
            metadata = json.loads((workspace / "research-run" / "run.json").read_text())
            if not metadata.get("finalized_at") or metadata.get("status") not in {"succeeded", "failed"}:
                raise RuntimeError("Praxist exited before publishing its finalized research artifacts.")
            return metadata
        time.sleep(poll_seconds)
    raise RuntimeError("Praxist exceeded the container's 45-minute run deadline.")


def main():
    global run_id, completed
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        started = subprocess.run([
        sys.executable, "-m", "praxist", "start", "--task-path", "/task",
        "--run-dir", "/work/research-run", "--agent-system", "codex_sdk",
        "--runtime", "agent_runtime:codex_sdk", "--model-provider", "model_provider:openai_compatible",
        "--model", os.environ["PRAXIST_MODEL"], "--startup-timeout", "45", "--json",
        ], capture_output=True, text=True, timeout=65, check=False)
        if started.returncode:
            raise RuntimeError((started.stderr or started.stdout).strip())
        receipt = json.loads(started.stdout[started.stdout.index("{"):])
        run_id = receipt["run_id"]
        temporary = root / "container-start.tmp"
        temporary.write_text(json.dumps(receipt), encoding="utf-8")
        temporary.replace(root / "container-start.json")
        # The backend writes an early summary before canonical materialization.
        # Wait for the actual CLI process to exit after finalizing its artifacts.
        metadata = wait_for_finalization(root, receipt["pid"])
        completion = {"run_id": run_id, "finalized_at": metadata["finalized_at"], "process_exited": True}
        temporary = root / "container-complete.tmp"
        temporary.write_text(json.dumps(completion), encoding="utf-8")
        temporary.replace(root / "container-complete.json")
        completed = True
    except Exception as error:
        (root / "container-error.json").write_text(json.dumps({"error": str(error)}), encoding="utf-8")
    finally:
        if not completed:
            stop()


if __name__ == "__main__":
    main()
