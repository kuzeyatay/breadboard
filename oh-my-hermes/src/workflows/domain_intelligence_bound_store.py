from __future__ import annotations

import errno
import os
from contextlib import contextmanager
from pathlib import Path
import stat
import time
from typing import Iterator

from ..system.local_store import FileLockTimeout

try:
    import fcntl
except ImportError:
    fcntl = None


_NOFOLLOW_FLAG = getattr(os, "O_NOFOLLOW", 0)
_NONBLOCK_FLAG = getattr(os, "O_NONBLOCK", 0)
_DIRECTORY_FLAG = getattr(os, "O_DIRECTORY", 0)
_CLOEXEC_FLAG = getattr(os, "O_CLOEXEC", 0)


def open_domain_directory_at(
    domain_root_fd: int,
    *relative_parts: str,
) -> int:
    """Open existing descendants without leaving a bound domain-root descriptor."""
    if not _NOFOLLOW_FLAG or not _DIRECTORY_FLAG:
        raise ValueError("domain-intelligence safe reads are unavailable")
    flags = os.O_RDONLY | _DIRECTORY_FLAG | _CLOEXEC_FLAG | _NOFOLLOW_FLAG
    directory_fd = os.dup(domain_root_fd)
    os.set_inheritable(directory_fd, False)
    try:
        for part in relative_parts:
            if Path(part).name != part or part in {"", ".", ".."}:
                raise ValueError("domain-intelligence descriptor path is unsafe")
            next_directory_fd = os.open(part, flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_directory_fd
        return directory_fd
    except (OSError, ValueError) as exc:
        os.close(directory_fd)
        if isinstance(exc, OSError) and exc.errno in {
            errno.ELOOP,
            errno.EMLINK,
            errno.ENOTDIR,
        }:
            raise ValueError(
                "domain-intelligence descriptor path contains a symlink or non-directory"
            ) from exc
        raise


@contextmanager
def shared_domain_store_lock_at(
    domain_root_fd: int,
    *,
    timeout_seconds: float = 0.25,
    poll_interval: float = 0.01,
) -> Iterator[dict[str, object]]:
    """Acquire the existing store lock through an already-bound root descriptor."""
    if fcntl is None or not _NOFOLLOW_FLAG or not _NONBLOCK_FLAG:
        raise ValueError("shared_lock_unavailable")
    flags = os.O_RDONLY | _CLOEXEC_FLAG | _NOFOLLOW_FLAG | _NONBLOCK_FLAG
    try:
        descriptor = os.open(".store.lock", flags, dir_fd=domain_root_fd)
    except OSError as exc:
        if exc.errno in {errno.ELOOP, errno.EMLINK}:
            raise ValueError(
                "domain-intelligence lock path must not be a symlink"
            ) from exc
        raise
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError("domain-intelligence lock path must be a regular file")
        deadline = time.monotonic() + min(max(timeout_seconds, 0.0), 0.25)
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
                break
            except OSError as exc:
                if exc.errno not in (errno.EACCES, errno.EAGAIN):
                    raise
                if time.monotonic() >= deadline:
                    raise FileLockTimeout(
                        "could not acquire bound domain store lock "
                        f"within {timeout_seconds}s"
                    ) from exc
                time.sleep(poll_interval)
        try:
            yield {"locked": True, "mode": "shared"}
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)
