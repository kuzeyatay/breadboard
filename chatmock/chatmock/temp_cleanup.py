"""Reclaim abandoned Breadboard plugin caches without deleting session data.

Only direct, tempfile-generated voice/Claude session directories are eligible.
This deliberately never removes a session home, documents, recordings, or DBs.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import json
import logging
import os
from pathlib import Path
import re
import stat
import tempfile
import threading
import time

log = logging.getLogger(__name__)
RETENTION_SECONDS = 7 * 24 * 60 * 60
INTERVAL_SECONDS = 60 * 60
SESSION_NAME = re.compile(r"breadboard-(?:voice|claude)-[a-z0-9_]{8}\Z")
LEASE_NAME = ".breadboard-session.json"
MAX_SESSION_ENTRIES = 100_000
PROTECTED_SUFFIXES = frozenset("""
.db .sqlite .sqlite3 .duckdb .mdb .accdb .db3 .sql .bak .backup .jsonl
.pdf .doc .docx .docm .odt .rtf .txt .md .markdown .tex .epub
.ppt .pptx .pptm .odp .xls .xlsx .xlsm .ods .csv .tsv .ipynb
.wav .mp3 .mp4 .m4a .m4v .mov .mkv .webm .aac .flac .ogg .opus .wma .avi .srt .vtt
.png .jpg .jpeg .gif .webp .svg .bmp .tif .tiff .heic
.step .stp .stl .obj .blend .sldprt .sldasm .dwg .dxf .3mf
""".split())


def _linked(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    )


def _checked(path: Path, root: Path) -> os.stat_result:
    """Validate the absolute scope and every ancestor; never follow junctions."""
    path.relative_to(root)
    for ancestor in (path, *path.parents):
        info = ancestor.lstat()
        if _linked(info):
            raise OSError("linked cleanup path")
    return path.lstat()


def _newest(info: os.stat_result) -> float:
    # Copied files can have old mtimes but a recent creation time on Windows.
    return max(info.st_mtime, getattr(info, "st_birthtime", info.st_ctime))


def _identity(info: os.stat_result) -> tuple:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _protected(path: Path) -> bool:
    name = path.name.lower()
    return (path.suffix.lower() in PROTECTED_SUFFIXES or ".sqlite" in name
            or name.endswith((".db-wal", ".db-shm", ".db-journal")))


def _pid_alive(pid: int) -> bool:
    """Treat access-denied/unknown process state as active, including PID reuse."""
    if pid <= 0:
        return True
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE only
        if not handle:
            return ctypes.get_last_error() != 87  # ERROR_INVALID_PARAMETER: gone
        try:
            return kernel.WaitForSingleObject(handle, 0) != 0
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except OSError:
        return True


def _active(session: Path) -> bool:
    marker = session / LEASE_NAME
    try:
        info = _checked(marker, session)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            return True
        lease = json.loads(marker.read_text(encoding="utf-8"))
        pids = lease["pids"]
        if not isinstance(pids, list) or not pids or len(pids) > 2:
            return True
        return any(type(pid) is not int or _pid_alive(pid) for pid in pids)
    except FileNotFoundError:
        return False  # Legacy homes still require a full seven-day inactivity check.
    except (OSError, ValueError, KeyError, TypeError):
        return True


class SessionLease:
    """Publish ownership across service restarts, including a surviving voice CLI."""

    def __init__(self, home: str):
        self.path = Path(home) / LEASE_NAME
        self.update()

    def update(self, child_pid: int | None = None) -> None:
        try:
            self.path.write_text(json.dumps({"pids": [os.getpid()] + (
                [child_pid] if child_pid is not None else []
            )}), encoding="utf-8")
        except OSError:
            # Cache housekeeping must not break voice on a full disk. Recent
            # creation/activity still excludes this home for seven days.
            log.warning("Could not record temporary-session ownership")

    def close(self) -> None:
        try:
            self.path.unlink(missing_ok=True)
        except OSError:
            # A leftover lease conservatively retains a cache until we exit.
            pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


@dataclass
class CleanupStats:
    sessions: int = 0
    files: int = 0
    bytes: int = 0
    skipped: int = 0
    errors: int = 0


@contextmanager
def _sweep_lock(root: Path):
    """Nonblocking OS lock: two local services must not prune the same cache."""
    lock_path = root / ".breadboard-temp-cleanup.lock"
    stream = None
    locked = False
    try:
        _checked(root, root)
        if lock_path.exists():
            info = _checked(lock_path, root)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise OSError("unsafe cleanup lock")
        stream = lock_path.open("a+b")
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locked = True
    except OSError:
        pass
    try:
        yield locked
    finally:
        if stream is not None:
            stream.close()  # Also releases the OS lock, even after exceptions.


def cleanup_steps(root: Path, stats: CleanupStats, *, now: float | None = None,
                  dry_run: bool = False):
    """Yield after each entry so the worker can throttle and stop mid-sweep."""
    root = Path(os.path.abspath(root))
    cutoff = (time.time() if now is None else now) - RETENTION_SECONDS
    _checked(root, root)
    with os.scandir(root) as sessions:
        for entry in sessions:
            yield
            if not SESSION_NAME.fullmatch(entry.name):
                continue
            session = root / entry.name
            cache = session / ".tmp" / "plugins"
            try:
                initial = _checked(session, root)
                if not stat.S_ISDIR(initial.st_mode) or _newest(initial) >= cutoff or _active(session):
                    stats.skipped += 1
                    continue
                if not stat.S_ISDIR(_checked(cache, root).st_mode):
                    continue
                # Inventory the whole home before deleting anything: even a
                # recent transcript/DB outside the cache makes a session active.
                pending = [session]
                candidates = []
                directories = []
                entries = 0
                stale = True
                while pending and stale:
                    directory = pending.pop()
                    _checked(directory, root)
                    with os.scandir(directory) as children:
                        for child in children:
                            yield
                            entries += 1
                            path = directory / child.name
                            # Windows DirEntry.stat() can report zero for inode
                            # and link count; lstat is needed for identity checks.
                            info = path.lstat()
                            if entries > MAX_SESSION_ENTRIES or _linked(info) or _newest(info) >= cutoff:
                                stale = False
                                break
                            if stat.S_ISDIR(info.st_mode):
                                pending.append(path)
                                if path == cache or path.is_relative_to(cache):
                                    directories.append(path)
                            elif (path.is_relative_to(cache) and stat.S_ISREG(info.st_mode)
                                  and info.st_nlink == 1 and not _protected(path)
                                  and not getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_READONLY):
                                candidates.append((path, info))
                if not stale or not candidates or _active(session):
                    stats.skipped += 1
                    continue
                if _identity(_checked(session, root)) != _identity(initial):
                    stats.skipped += 1
                    continue
                # Invalidate before the first deletion, including interrupted
                # passes, so a later CLI rebuilds an incomplete plugin cache.
                marker = session / ".tmp" / "plugins.sha"
                if marker.exists():
                    info = _checked(marker, root)
                    if not stat.S_ISREG(info.st_mode) or _newest(info) >= cutoff:
                        stats.skipped += 1
                        continue
                    if not dry_run:
                        marker.unlink()
                stats.sessions += 1
                for path, previous in candidates:
                    yield
                    if _active(session):
                        break
                    try:
                        current = _checked(path, root)
                        if _identity(current) != _identity(previous) or current.st_nlink != 1:
                            continue
                        if not dry_run:
                            path.unlink()  # File-only deletion, never recursive.
                        stats.files += 1
                        stats.bytes += previous.st_size
                    except OSError:
                        stats.errors += 1
                if not dry_run:
                    for directory in reversed(directories):
                        yield
                        if _active(session):
                            break
                        try:
                            _checked(directory, root)
                            directory.rmdir()  # Retained data keeps parents intact.
                        except OSError:
                            pass
            except FileNotFoundError:
                continue
            except OSError:
                stats.errors += 1


class TempCleanupWorker:
    """One daemon per serving process; startup sweep, then hourly sweeps."""

    def __init__(self, root: Path | None = None):
        self.root = Path(tempfile.gettempdir()) if root is None else root
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, name="breadboard-temp-cleanup", daemon=True)

    def start(self) -> None:
        try:
            self.thread.start()
        except RuntimeError:
            log.exception("Could not start temporary-cache cleanup worker")

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread.ident is not None:
            self.thread.join(timeout=2)

    def _run(self) -> None:
        while not self.stop_event.is_set():
            stats = CleanupStats()
            try:
                with _sweep_lock(self.root) as acquired:
                    if acquired:
                        steps = cleanup_steps(self.root, stats)
                        try:
                            for index, _ in enumerate(steps):
                                if self.stop_event.is_set():
                                    break
                                # Limit I/O bursts and yield to interactive work.
                                if index % 250 == 249 and self.stop_event.wait(0.1):
                                    break
                        finally:
                            steps.close()
                if stats.files or stats.errors:
                    log.warning("Temp cache cleanup: %d files, %d bytes reclaimed, %d sessions, %d skipped, %d errors",
                                stats.files, stats.bytes, stats.sessions, stats.skipped, stats.errors)
            except Exception:
                log.exception("Temp cache cleanup failed; will retry next hour")
            if self.stop_event.wait(INTERVAL_SECONDS):
                return
