from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from chatmock import temp_cleanup as cleanup


class TempCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.session = self.root / "breadboard-voice-1234abcd"
        self.cache = self.session / ".tmp" / "plugins"
        self.cache.mkdir(parents=True)
        self.now = time.time() + cleanup.RETENTION_SECONDS + 60

    def put(self, path, content=b"keep me"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def sweep(self, **kwargs):
        result = cleanup.CleanupStats()
        list(cleanup.cleanup_steps(self.root, result, now=self.now, **kwargs))
        return result

    def test_only_stale_plugin_cache_files_are_deleted(self):
        disposable = self.put(self.cache / "runtime" / "module.pyc", b"x" * 1024)
        marker = self.put(self.cache.parent / "plugins.sha")
        protected = [
            self.put(self.cache / name) for name in (
                "notes.md", "report.pdf", "recording.webm", "photo.png", "project.ipynb",
                "data.db", "data.db-wal", "data.db-shm", "data.sqlite3-journal",
                "history.jsonl", "design.step", "data.duckdb",
            )
        ] + [self.put(self.session / "state.sqlite"),
             self.put(self.session / "source.py"),
             self.put(self.root / "project" / ".tmp" / "plugins" / "app.js"),
             self.put(self.root / "breadboard-voice-unit-1234abcd" / ".tmp" / "plugins" / "app.js")]
        before = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in protected}
        result = self.sweep()
        self.assertFalse(disposable.exists())
        self.assertFalse(marker.exists())
        self.assertEqual((result.files, result.bytes, result.errors), (1, 1024, 0))
        for path, original in before.items():
            self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), original)
        self.assertTrue(self.session.exists())

    def test_dry_run_never_changes_files_or_cache_marker(self):
        cached = self.put(self.cache / "app.js")
        marker = self.put(self.cache.parent / "plugins.sha")
        result = self.sweep(dry_run=True)
        self.assertEqual(result.files, 1)
        self.assertTrue(cached.exists())
        self.assertTrue(marker.exists())

    def test_recent_session_and_recent_file_outside_cache_block_deletion(self):
        cached = self.put(self.cache / "app.js")
        self.now = time.time()
        self.assertEqual(self.sweep().files, 0)
        self.now += cleanup.RETENTION_SECONDS + 60
        database = self.put(self.session / "sessions" / "state.db")
        os.utime(database, (self.now, self.now))
        self.assertEqual(self.sweep().files, 0)
        self.assertTrue(cached.exists())

    def test_recent_creation_time_wins_over_copied_old_mtime(self):
        cached = self.put(self.cache / "app.js")
        for path in (cached, self.cache, self.cache.parent, self.session):
            os.utime(path, (1, 1))
        self.now = time.time()
        self.assertEqual(self.sweep().files, 0)
        self.assertTrue(cached.exists())

    def test_live_owner_and_surviving_child_are_protected(self):
        cached = self.put(self.cache / "app.js")
        marker = self.put(self.session / cleanup.LEASE_NAME)
        for pids in ([os.getpid()], [234, 567]):
            marker.write_text(json.dumps({"pids": pids}))
            with patch.object(cleanup, "_pid_alive", side_effect=lambda pid: pid != 234):
                self.assertEqual(self.sweep().files, 0)
            self.assertTrue(cached.exists())
        marker.write_text(json.dumps({"pids": [234, 567]}))
        with patch.object(cleanup, "_pid_alive", return_value=False):
            self.assertEqual(self.sweep().files, 1)

    def test_malformed_lease_fails_closed(self):
        cached = self.put(self.cache / "app.js")
        marker = self.put(self.session / cleanup.LEASE_NAME)
        for content in ("{", "null", '{"pids": []}', '{"pids": ["42"]}'):
            marker.write_text(content)
            self.assertEqual(self.sweep().files, 0)
        self.assertTrue(cached.exists())

    def test_lease_releases_on_exception_and_detects_real_process(self):
        self.assertTrue(cleanup._pid_alive(os.getpid()))
        with self.assertRaisesRegex(RuntimeError, "end"):
            with cleanup.SessionLease(str(self.session)) as lease:
                lease.update(os.getpid())
                self.assertTrue(cleanup._active(self.session))
                raise RuntimeError("end")
        self.assertFalse((self.session / cleanup.LEASE_NAME).exists())

    def test_symlink_or_junction_cannot_redirect_cleanup(self):
        target = self.root / "documents"
        saved = self.put(target / "app.js")
        link = self.cache / "redirect"
        if os.name == "nt":
            # Native directory junction; no administrator symlink privilege needed.
            command = f"New-Item -ItemType Junction -Path '{link}' -Target '{target}' | Out-Null"
            result = subprocess.run(["powershell", "-NoProfile", "-Command", command], capture_output=True)
            if result.returncode:
                self.skipTest("junction creation unavailable")
        else:
            link.symlink_to(target, target_is_directory=True)
        try:
            self.assertEqual(self.sweep().files, 0)
            self.assertEqual(saved.read_bytes(), b"keep me")
        finally:
            if os.name == "nt":
                link.rmdir()
            else:
                link.unlink()

    def test_hard_links_and_read_only_cache_files_are_preserved(self):
        original = self.put(self.root / "project.js")
        linked = self.cache / "linked.js"
        os.link(original, linked)
        self.assertEqual(self.sweep().files, 0)
        self.assertTrue(linked.exists())
        if os.name == "nt":
            readonly = self.put(self.cache / "readonly.js")
            readonly.chmod(0o444)
            try:
                self.assertEqual(self.sweep().files, 0)
                self.assertTrue(readonly.exists())
            finally:
                readonly.chmod(0o666)

    def test_changed_file_is_not_deleted_after_inventory(self):
        cached = self.put(self.cache / "app.js")
        result = cleanup.CleanupStats()
        steps = cleanup.cleanup_steps(self.root, result, now=self.now)
        for _ in steps:
            if result.sessions:
                cached.write_bytes(b"changed during cleanup")
                break
        list(steps)
        self.assertEqual(result.files, 0)
        self.assertTrue(cached.exists())

    def test_inventory_limit_is_conservative(self):
        cached = self.put(self.cache / "app.js")
        with patch.object(cleanup, "MAX_SESSION_ENTRIES", 2):
            self.assertEqual(self.sweep().files, 0)
        self.assertTrue(cached.exists())

    @unittest.skipUnless(os.name == "nt", "Windows file-sharing locks")
    def test_locked_file_is_retained_and_retried_on_next_sweep(self):
        import ctypes
        from ctypes import wintypes

        cached = self.put(self.cache / "app.js")
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                      wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = kernel.CreateFileW(str(cached), 0x80000000, 0, None, 3, 0, None)
        self.assertNotEqual(handle, wintypes.HANDLE(-1).value)
        try:
            self.assertEqual(self.sweep().files, 0)
            self.assertTrue(cached.exists())
        finally:
            kernel.CloseHandle(handle)
        self.assertEqual(self.sweep().files, 1)

    def test_stop_between_inventory_and_deletion_preserves_cache(self):
        cached = self.put(self.cache / "app.js")
        worker = cleanup.TempCleanupWorker(self.root)
        original = cleanup.cleanup_steps

        def stopping_steps(root, stats):
            steps = original(root, stats, now=self.now)
            try:
                for item in steps:
                    if stats.sessions:
                        worker.stop_event.set()
                    yield item
            finally:
                steps.close()

        with patch.object(cleanup, "cleanup_steps", stopping_steps):
            worker.start()
            worker.thread.join(timeout=2)
            worker.stop()
        self.assertFalse(worker.thread.is_alive())
        self.assertTrue(cached.exists())

    def test_os_lock_prevents_two_simultaneous_sweeps(self):
        with cleanup._sweep_lock(self.root) as first:
            with cleanup._sweep_lock(self.root) as second:
                self.assertTrue(first)
                self.assertFalse(second)
        with cleanup._sweep_lock(self.root) as third:
            self.assertTrue(third)

    def test_worker_runs_at_startup_retries_and_stops_without_waiting_an_hour(self):
        called = threading.Event()
        calls = []

        def sweep(*args):
            calls.append(1)
            if len(calls) == 1:
                raise OSError("locked directory")
            called.set()
            yield

        worker = cleanup.TempCleanupWorker(self.root)
        with patch.object(cleanup, "cleanup_steps", sweep), patch.object(cleanup, "INTERVAL_SECONDS", 0.01):
            with self.assertLogs(cleanup.log, level="ERROR"):
                worker.start()
                try:
                    self.assertTrue(called.wait(2))
                finally:
                    worker.stop()
        self.assertFalse(worker.thread.is_alive())
        self.assertGreaterEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
