from __future__ import annotations

import errno
import os
from contextlib import contextmanager
from pathlib import Path
import stat
import time
from typing import Iterator

from ..paths import OmhPaths
from ..system.local_store import FileLockTimeout
from .domain_intelligence_store_writer import (
    atomic_write_managed_json,
    open_domain_directory,
    open_domain_directory_path,
    read_managed_json_at,
)

__all__ = ("atomic_write_managed_json",)

try:
    import fcntl
except ImportError:
    fcntl = None


_NOFOLLOW_FLAG = getattr(os, "O_NOFOLLOW", 0)
_CLOEXEC_FLAG = getattr(os, "O_CLOEXEC", 0)
_MANAGED_DIRECTORIES = frozenset(
    {"candidates", "history", "operations", "profiles", "reviews"}
)

# These bounds keep local reviewed metadata cheap to inspect and diagnose.
MAX_DOMAIN_ARTIFACT_BYTES = 256 * 1024
MAX_DOMAIN_CANDIDATE_FILES = 256
MAX_DOMAIN_ARTIFACT_FILES = 1024
MAX_DOMAIN_JSON_DEPTH = 32
MAX_DOMAIN_JSON_NODES = 4096
MAX_DOMAIN_DIAGNOSTICS = 64


def ensure_new_artifact_capacity(
    directory: Path,
    target: Path,
    *,
    limit: int,
    reason: str,
) -> None:
    paths, overflow = bounded_json_paths(directory, limit=max(limit - 1, 0))
    if not target.exists() and (overflow or len(paths) >= limit):
        raise ValueError(reason)


def bounded_json_paths(directory: Path, *, limit: int) -> tuple[tuple[Path, ...], bool]:
    """Return at most ``limit + 1`` JSON paths without an unbounded scan."""
    paths: list[Path] = []
    scan_limit = max(limit * 2 + 1, 1)
    scanned = 0
    scan_overflow = False
    with anchored_directory_path(directory) as directory_fd:
        with os.scandir(directory_fd) as entries:
            for entry in entries:
                scanned += 1
                if scanned > scan_limit:
                    scan_overflow = True
                    break
                if entry.name.endswith(".json"):
                    paths.append(directory / entry.name)
                    if len(paths) > limit:
                        break
    overflow = len(paths) > limit or scan_overflow
    return tuple(sorted(paths)), overflow


def secure_domain_root(paths: OmhPaths, *, create: bool = False) -> Path:
    root = paths.memory_dir / "domain-intelligence"
    try:
        descriptor = open_domain_directory(paths, create=create)
    except FileNotFoundError:
        if create:
            raise
        return root
    os.close(descriptor)
    return root


def secure_managed_dir(paths: OmhPaths, name: str, *, create: bool = True) -> Path:
    if name not in _MANAGED_DIRECTORIES:
        raise ValueError("unsafe_domain_managed_directory")
    with anchored_managed_directory(paths, name, create=create):
        return paths.memory_dir / "domain-intelligence" / name


def secure_artifact_path(directory: Path, filename: str) -> Path:
    if Path(filename).name != filename:
        raise ValueError("domain-intelligence artifact path must remain managed")
    path = directory / filename
    with anchored_directory_path(directory) as directory_fd:
        try:
            file_stat = os.stat(filename, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            return path
        if stat.S_ISLNK(file_stat.st_mode):
            raise ValueError("domain-intelligence artifact path must not be a symlink")
        if not stat.S_ISREG(file_stat.st_mode):
            raise ValueError("domain-intelligence artifact path must be a regular file")
    return path


def secure_store_lock_target(paths: OmhPaths) -> Path:
    root = paths.memory_dir / "domain-intelligence"
    with _domain_root_descriptor(paths) as directory_fd:
        _validate_lock_entry(directory_fd)
    return root / "store"


@contextmanager
def anchored_managed_directory(
    paths: OmhPaths,
    name: str,
    *,
    create: bool = True,
) -> Iterator[int]:
    if name not in _MANAGED_DIRECTORIES:
        raise ValueError("unsafe_domain_managed_directory")
    descriptor = open_domain_directory(paths, name, create=create)
    try:
        yield descriptor
    finally:
        os.close(descriptor)


@contextmanager
def anchored_directory_path(directory: Path) -> Iterator[int]:
    descriptor = open_domain_directory_path(directory)
    try:
        yield descriptor
    finally:
        os.close(descriptor)


@contextmanager
def _domain_root_descriptor(paths: OmhPaths) -> Iterator[int]:
    descriptor = open_domain_directory(paths, create=True)
    try:
        yield descriptor
    finally:
        os.close(descriptor)


def _validate_lock_entry(directory_fd: int) -> None:
    try:
        lock_stat = os.stat(
            ".store.lock",
            dir_fd=directory_fd,
            follow_symlinks=False,
        )
    except FileNotFoundError:
        return
    if stat.S_ISLNK(lock_stat.st_mode):
        raise ValueError("domain-intelligence lock path must not be a symlink")
    if not stat.S_ISREG(lock_stat.st_mode):
        raise ValueError("domain-intelligence lock path must be a regular file")


def _lock_descriptor(
    descriptor: int,
    target: Path,
    timeout_seconds: float,
    poll_interval: float,
) -> None:
    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
        raise ValueError("domain-intelligence lock path must be a regular file")
    os.fchmod(descriptor, 0o600)
    if fcntl is None:
        return
    deadline = time.monotonic() + max(timeout_seconds, 0.0)
    while True:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except OSError as exc:
            if exc.errno not in (errno.EACCES, errno.EAGAIN):
                raise
            if time.monotonic() >= deadline:
                raise FileLockTimeout(
                    f"could not acquire lock on {target} within {timeout_seconds}s"
                ) from exc
            time.sleep(poll_interval)


@contextmanager
def domain_store_lock(
    paths: OmhPaths,
    *,
    timeout_seconds: float = 10.0,
    poll_interval: float = 0.05,
) -> Iterator[dict[str, object]]:
    target = paths.memory_dir / "domain-intelligence" / "store"
    flags = os.O_RDWR | os.O_CREAT | os.O_APPEND | _CLOEXEC_FLAG
    if not _NOFOLLOW_FLAG:
        raise ValueError("domain-intelligence safe lock requires O_NOFOLLOW")
    with _domain_root_descriptor(paths) as root_fd:
        try:
            descriptor = os.open(
                ".store.lock",
                flags | _NOFOLLOW_FLAG,
                0o600,
                dir_fd=root_fd,
            )
        except OSError as exc:
            if exc.errno in {errno.ELOOP, errno.EMLINK}:
                raise ValueError(
                    "domain-intelligence lock path must not be a symlink"
                ) from exc
            raise
        try:
            _lock_descriptor(descriptor, target, timeout_seconds, poll_interval)
            try:
                yield {
                    "locked": fcntl is not None,
                    "reason": "" if fcntl else "fcntl_unavailable",
                }
            finally:
                if fcntl is not None:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def read_bounded_json(path: Path) -> dict[str, object] | None:
    with anchored_directory_path(path.parent) as directory_fd:
        return read_bounded_json_at(directory_fd, path.name)


def read_bounded_json_at(
    directory_fd: int,
    filename: str,
) -> dict[str, object] | None:
    return read_managed_json_at(
        directory_fd,
        filename,
        max_bytes=MAX_DOMAIN_ARTIFACT_BYTES,
        max_depth=MAX_DOMAIN_JSON_DEPTH,
        max_nodes=MAX_DOMAIN_JSON_NODES,
    )
