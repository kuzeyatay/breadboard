from __future__ import annotations

import errno
import json
import os
from pathlib import Path
import secrets
import stat

from ..paths import OmhPaths
from .domain_intelligence_bounded_json import (
    decode_bounded_json_object,
    read_limited_bytes,
)


_NOFOLLOW_FLAG = getattr(os, "O_NOFOLLOW", 0)
_DIRECTORY_FLAG = getattr(os, "O_DIRECTORY", 0)
_CLOEXEC_FLAG = getattr(os, "O_CLOEXEC", 0)
_MANAGED_DIRECTORIES = frozenset(
    {"candidates", "history", "operations", "profiles", "reviews"}
)
_HEALTH_DIRECTORIES = ("profiles", "reviews", "history")


def open_domain_directory(
    paths: OmhPaths,
    *relative_parts: str,
    create: bool,
) -> int:
    """Open a domain directory through one anchored, no-follow descriptor chain."""
    home = Path(os.path.abspath(paths.omh_home))
    directory_fd = _open_home_tree(
        home,
        ("memory", "domain-intelligence", *relative_parts),
        create=create,
    )
    if create and not relative_parts:
        try:
            _ensure_health_directories(directory_fd)
        except (OSError, ValueError):
            os.close(directory_fd)
            raise
    return directory_fd


def open_domain_directory_path(directory: Path) -> int:
    """Open an existing domain directory without re-resolving managed parents."""
    absolute = Path(os.path.abspath(directory))
    parts = absolute.parts
    domain_index = _domain_component_index(parts)
    home = Path(*parts[: domain_index - 1])
    relative_parts = parts[domain_index + 1 :]
    return _open_home_tree(
        home,
        ("memory", "domain-intelligence", *relative_parts),
        create=False,
    )


def read_managed_json_at(
    directory_fd: int,
    filename: str,
    *,
    max_bytes: int,
    max_depth: int,
    max_nodes: int,
) -> dict[str, object] | None:
    if Path(filename).name != filename:
        raise ValueError("artifact_path_escape")
    if not _NOFOLLOW_FLAG:
        raise ValueError("domain-intelligence safe reads require O_NOFOLLOW")
    flags = os.O_RDONLY | _CLOEXEC_FLAG | _NOFOLLOW_FLAG
    try:
        descriptor = os.open(filename, flags, dir_fd=directory_fd)
    except FileNotFoundError:
        return None
    except OSError as exc:
        if exc.errno in {errno.ELOOP, errno.EMLINK}:
            raise ValueError("artifact_symlink") from exc
        raise
    try:
        file_stat = os.fstat(descriptor)
        if not stat.S_ISREG(file_stat.st_mode):
            raise ValueError("symlink_or_not_file")
        if file_stat.st_size > max_bytes:
            raise ValueError("artifact_too_large")
        raw = read_limited_bytes(descriptor, max_bytes)
    finally:
        os.close(descriptor)
    if len(raw) > max_bytes:
        raise ValueError("artifact_too_large")
    return decode_bounded_json_object(
        raw,
        max_depth=max_depth,
        max_nodes=max_nodes,
    )


def atomic_write_managed_json(
    paths: OmhPaths,
    managed_name: str,
    filename: str,
    data: dict[str, object],
) -> None:
    """Atomically write private JSON below one dirfd-anchored managed directory."""
    if managed_name not in _MANAGED_DIRECTORIES:
        raise ValueError("unsafe_domain_managed_directory")
    if Path(filename).name != filename or not filename.endswith(".json"):
        raise ValueError("unsafe_domain_artifact_filename")
    directory_fd = open_domain_directory(paths, managed_name, create=True)
    temporary_name = f".{filename}.{os.getpid()}-{secrets.token_hex(8)}.tmp"
    temporary_created = False
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | _CLOEXEC_FLAG | _NOFOLLOW_FLAG
        temporary_fd = os.open(temporary_name, flags, 0o600, dir_fd=directory_fd)
        temporary_created = True
        try:
            if not stat.S_ISREG(os.fstat(temporary_fd).st_mode):
                raise ValueError("domain-intelligence temporary path must be regular")
            os.fchmod(temporary_fd, 0o600)
            _write_all(
                temporary_fd,
                (json.dumps(data, indent=2, sort_keys=True) + "\n").encode("utf-8"),
            )
            os.fsync(temporary_fd)
        finally:
            os.close(temporary_fd)
        os.replace(
            temporary_name,
            filename,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
        temporary_created = False
        os.fsync(directory_fd)
    except (TypeError, NotImplementedError) as exc:
        raise ValueError(
            "domain-intelligence safe managed writes are unavailable"
        ) from exc
    finally:
        if temporary_created:
            try:
                os.unlink(temporary_name, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        os.close(directory_fd)


def _open_home_tree(
    home: Path,
    relative_parts: tuple[str, ...],
    *,
    create: bool,
) -> int:
    if not _NOFOLLOW_FLAG or not _DIRECTORY_FLAG:
        raise ValueError("domain-intelligence safe managed writes are unavailable")
    if not home.is_absolute() or home.name in {"", ".", ".."}:
        raise ValueError("domain-intelligence managed storage cannot be safely opened")
    flags = os.O_RDONLY | _DIRECTORY_FLAG | _CLOEXEC_FLAG | _NOFOLLOW_FLAG
    directory_fd = -1
    try:
        directory_fd, missing_parts = _open_anchor(home.parent, flags, create=create)
        parts = (*missing_parts, home.name, *relative_parts)
        for index, part in enumerate(parts):
            if Path(part).name != part or part in {"", ".", ".."}:
                raise ValueError(
                    "domain-intelligence managed storage cannot be safely opened"
                )
            try:
                next_directory_fd = os.open(part, flags, dir_fd=directory_fd)
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(part, 0o700, dir_fd=directory_fd)
                next_directory_fd = os.open(part, flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_directory_fd
            if index:
                os.fchmod(directory_fd, 0o700)
        return directory_fd
    except (OSError, ValueError) as exc:
        if directory_fd >= 0:
            os.close(directory_fd)
        if isinstance(exc, OSError) and exc.errno in {
            errno.ELOOP,
            errno.EMLINK,
            errno.ENOTDIR,
        }:
            raise ValueError(
                "domain-intelligence managed storage cannot be safely opened: "
                "symlink or non-directory component"
            ) from exc
        raise


def _ensure_health_directories(domain_root_fd: int) -> None:
    """Create the complete resolver health universe for a writable store."""
    flags = os.O_RDONLY | _DIRECTORY_FLAG | _CLOEXEC_FLAG | _NOFOLLOW_FLAG
    for name in _HEALTH_DIRECTORIES:
        try:
            os.mkdir(name, 0o700, dir_fd=domain_root_fd)
        except FileExistsError:
            pass
        try:
            descriptor = os.open(name, flags, dir_fd=domain_root_fd)
        except OSError as exc:
            if exc.errno in {errno.ELOOP, errno.EMLINK, errno.ENOTDIR}:
                raise ValueError(
                    "domain-intelligence health directory contains a symlink or non-directory"
                ) from exc
            raise
        try:
            os.fchmod(descriptor, 0o700)
        finally:
            os.close(descriptor)


def _domain_component_index(parts: tuple[str, ...]) -> int:
    for index in range(len(parts) - 1, 1, -1):
        if parts[index] == "domain-intelligence" and parts[index - 1] == "memory":
            return index
    raise ValueError("domain-intelligence path is outside managed storage")


def _open_anchor(path: Path, flags: int, *, create: bool) -> tuple[int, tuple[str, ...]]:
    missing: list[str] = []
    current = path
    while True:
        try:
            return os.open(current, flags), tuple(reversed(missing))
        except FileNotFoundError:
            if not create or current == current.parent:
                raise
            missing.append(current.name)
            current = current.parent


def _write_all(file_descriptor: int, payload: bytes) -> None:
    view = memoryview(payload)
    while view:
        written = os.write(file_descriptor, view)
        if written <= 0:
            raise OSError("domain-intelligence managed write made no progress")
        view = view[written:]
