"""Exercise real OS locks and terminal receipts without a model or network."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest


ROOT = Path(os.environ.get("BREADBOARD_TEST_REPO", Path(__file__).resolve().parents[2]))
SOURCE = Path(os.environ.get("BREADBOARD_TEST_CANDIDATE", ROOT))


def registry_module():
    name = "resource2skill_lock_under_test"
    module = types.ModuleType(name)
    # The unchanged schemas remain beside the original module. Only code is
    # overlaid when validating a staged candidate before an idle activation.
    original = ROOT / "Resource2Skill/core/skill_wiki/registry.py"
    module.__file__ = str(original)
    sys.modules[name] = module
    source = SOURCE / "Resource2Skill/core/skill_wiki/registry.py"
    exec(compile(source.read_text(encoding="utf-8"), str(source), "exec"), module.__dict__)
    return module


def bridge_module():
    source = SOURCE / "scripts/resource2skill-bridge.py"
    spec = importlib.util.spec_from_file_location("resource2skill_bridge_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FileLockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = registry_module()

    def test_reentrant_and_exception_release_on_a_new_thread(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "index.lock"
            errors = []

            def use_lock():
                try:
                    with self.assertRaisesRegex(ValueError, "owned failure"):
                        with self.registry._file_lock(lock):
                            with self.registry._file_lock(lock.parent / "." / lock.name):
                                raise ValueError("owned failure")
                    with self.registry._file_lock(lock):
                        pass
                except BaseException as exc:
                    errors.append(exc)

            thread = threading.Thread(target=use_lock, daemon=True)
            thread.start()
            thread.join(5)
            self.assertFalse(thread.is_alive(), "nested lock did not release")
            self.assertEqual(errors, [])

    def test_other_thread_waits_until_release(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "index.lock"
            waiting = threading.Event()
            acquired = threading.Event()
            errors = []

            def contender():
                waiting.set()
                try:
                    with self.registry._file_lock(lock):
                        acquired.set()
                except BaseException as exc:
                    errors.append(exc)

            with self.registry._file_lock(lock):
                thread = threading.Thread(target=contender, daemon=True)
                thread.start()
                self.assertTrue(waiting.wait(2))
                self.assertFalse(acquired.wait(0.2), "another thread entered a held lock")
            thread.join(5)
            self.assertFalse(thread.is_alive())
            self.assertEqual(errors, [])
            self.assertTrue(acquired.is_set())

    def test_processes_cannot_lose_registry_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            counter = Path(directory) / "counter.json"
            counter.write_text("0", encoding="utf-8")
            processes = []
            try:
                for _ in range(4):
                    processes.append(subprocess.Popen(
                        [sys.executable, __file__, "--lock-worker", str(counter)],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                    ))
                for process in processes:
                    stdout, stderr = process.communicate(timeout=30)
                    self.assertEqual(process.returncode, 0, stdout + stderr)
                self.assertEqual(json.loads(counter.read_text(encoding="utf-8")), 120)
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                        process.communicate(timeout=5)


class TerminalReceiptTests(unittest.TestCase):
    def test_failure_preserves_the_original_error_once(self):
        self.check_result(False, "MCP startup failed", "extra note", "MCP startup failed", 2)

    def test_failure_falls_back_to_note_then_summary(self):
        self.check_result(False, None, "No result", "No result", 2)
        self.check_result(False, None, None, "Résumé ready", 2)

    def test_success_receipt_matches_the_terminal_event(self):
        self.check_result(True, None, None, None, 0)

    def check_result(self, success, error, note, expected_error, expected_code):
        bridge = bridge_module()
        result = types.SimpleNamespace(success=success, error=error, note=note,
            final_message="Résumé ready", iterations=3, tool_calls=[1, 2])
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()) as output:
            code = bridge.publish_result(result, domain="web", workspace=Path(directory))
            receipt = json.loads((Path(directory) / ".breadboard-result.json").read_text(encoding="utf-8"))
        self.assertEqual(code, expected_code)
        event = json.loads(output.getvalue())
        self.assertEqual(event.pop("event"), "run.completed" if success else "run.failed")
        self.assertEqual(event, receipt)
        self.assertEqual(receipt["error"], expected_error)
        self.assertEqual(receipt["toolCalls"], 2)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--lock-worker":
        registry = registry_module()
        counter = Path(sys.argv[2])
        for _ in range(30):
            with registry._file_lock(counter.with_suffix(".lock")):
                previous = json.loads(counter.read_text(encoding="utf-8"))
                time.sleep(0.002)
                counter.write_text(json.dumps(previous + 1), encoding="utf-8")
    else:
        unittest.main()
