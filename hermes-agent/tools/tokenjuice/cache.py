"""Disk cache for compressed tool output and its expandable source.

Two jobs. First, compressing the same output twice — the same file read in
two turns, the same API response — should cost once. Second, and more
important, the *source* an elision refers to has to outlive the tool call, or
``expand_output`` has nothing to read. The existing sandbox spill in
``tool_result_storage`` writes into the environment and depends on that write
succeeding; this cache lives on the Hermes side and always exists, so
recovery works even on backends where the spill failed.

Layout under ``$HERMES_HOME/tokenjuice/``::

    blobs/<first two hex>/<handle>.src    the expandable source text
    blobs/<first two hex>/<handle>.json   compressed text, spans, stats

Entries are content-addressed, so an identical output written by two
different tools shares one blob. Pruning is opportunistic: doing it on a
fraction of writes keeps the common path free of a directory walk.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Bumped whenever a compressor's output changes. Entries are keyed by it, so a
# logic change invalidates the cache rather than serving results produced by
# code that no longer exists.
ENGINE_VERSION = "1"

_HANDLE_CHARS = 12
# What the markers embed. Long enough that a collision inside one cache is
# not a practical concern, short enough not to tax the context it rides in.
MARKER_CHARS = 6

_PRUNE_PROBABILITY = 0.02


@dataclass
class CacheEntry:
    """Everything ``expand_output`` needs to answer without the tool re-running."""

    handle: str
    tool_name: str
    fmt: str
    original_chars: int
    source_chars: int
    source_lines: int
    compressed_chars: int
    created_at: float
    source_note: str = ""
    spans: List[Dict[str, Any]] = field(default_factory=list)
    compressed_text: str = ""


def cache_root() -> Path:
    """The cache directory, following the active Hermes profile."""
    try:
        from hermes_constants import get_hermes_home

        return Path(get_hermes_home()) / "tokenjuice"
    except Exception:
        return Path(tempfile.gettempdir()) / "hermes-tokenjuice"


def compute_handle(source: str, fmt: str) -> str:
    digest = hashlib.sha256(
        f"{ENGINE_VERSION}\0{fmt}\0{source}".encode("utf-8", "replace")
    ).hexdigest()
    return digest[:_HANDLE_CHARS]


def _paths(handle: str) -> Tuple[Path, Path]:
    shard = cache_root() / "blobs" / handle[:2]
    return shard / f"{handle}.src", shard / f"{handle}.json"


def _write_atomic(path: Path, data: str) -> None:
    """Write via a temp file in the same directory, then replace.

    A torn read of a half-written blob would surface as a confusing partial
    expansion rather than an error, so the rename has to be the only moment
    the file becomes visible.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(data)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def store(entry: CacheEntry, source: str) -> bool:
    """Persist an entry and its source. Returns False if the cache is unusable.

    A cache failure must never fail the tool call — the compressed text is
    still correct, it just loses the ability to be expanded, and the caller
    degrades to the existing spill path.
    """
    try:
        src_path, meta_path = _paths(entry.handle)
        _write_atomic(src_path, source)
        _write_atomic(meta_path, json.dumps(asdict(entry), ensure_ascii=False))
    except Exception as exc:
        logger.debug("TokenJuice cache write failed for %s: %s", entry.handle, exc)
        return False

    if random.random() < _PRUNE_PROBABILITY:
        try:
            prune()
        except Exception as exc:
            logger.debug("TokenJuice cache prune failed: %s", exc)
    return True


def load(handle: str) -> Optional[CacheEntry]:
    """Load an entry by its exact handle."""
    _, meta_path = _paths(handle)
    try:
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    try:
        return CacheEntry(**raw)
    except TypeError:
        return None


def load_source(handle: str) -> Optional[str]:
    src_path, _ = _paths(handle)
    try:
        return src_path.read_text(encoding="utf-8")
    except Exception:
        return None


def touch(handle: str) -> None:
    """Mark an entry as recently used, so pruning evicts it last."""
    now = time.time()
    for path in _paths(handle):
        try:
            os.utime(path, (now, now))
        except OSError:
            pass


def resolve(prefix: str) -> Tuple[Optional[str], List[str]]:
    """Resolve a handle prefix to one handle.

    Markers carry a short prefix rather than the full handle, so this has to
    report ambiguity explicitly instead of guessing: returning the wrong blob
    would hand the model a confidently wrong expansion.

    Returns ``(handle, candidates)`` — ``handle`` is set only on an exact
    single match; otherwise ``candidates`` lists what it could have meant.
    """
    cleaned = "".join(ch for ch in (prefix or "").strip().lower() if ch in "0123456789abcdef")
    if not cleaned:
        return None, []

    if len(cleaned) == _HANDLE_CHARS:
        src_path, _ = _paths(cleaned)
        return (cleaned, []) if src_path.exists() else (None, [])

    shard = cache_root() / "blobs" / cleaned[:2]
    try:
        candidates = sorted(
            path.stem for path in shard.glob("*.src") if path.stem.startswith(cleaned)
        )
    except Exception:
        return None, []

    if len(candidates) == 1:
        return candidates[0], []
    return None, candidates


def prune() -> None:
    """Drop entries past the age or size ceiling, oldest first."""
    from tools.tokenjuice.config import get_config

    config = get_config()
    root = cache_root() / "blobs"
    if not root.exists():
        return

    max_age = config.cache_max_age_days * 86_400
    now = time.time()
    entries: List[Tuple[float, int, Path]] = []

    for path in root.glob("*/*.src"):
        try:
            stat = path.stat()
        except OSError:
            continue
        meta = path.with_suffix(".json")
        try:
            size = stat.st_size + (meta.stat().st_size if meta.exists() else 0)
        except OSError:
            size = stat.st_size
        if now - stat.st_mtime > max_age:
            _remove(path, meta)
            continue
        entries.append((stat.st_mtime, size, path))

    ceiling = config.cache_max_mb * 1024 * 1024
    total = sum(size for _, size, _ in entries)
    if total <= ceiling:
        return

    entries.sort(key=lambda item: item[0])
    for _, size, path in entries:
        if total <= ceiling:
            break
        _remove(path, path.with_suffix(".json"))
        total -= size


def _remove(*paths: Path) -> None:
    for path in paths:
        try:
            path.unlink()
        except OSError:
            pass


def stats() -> Dict[str, int]:
    """Entry count and byte size of the cache, for diagnostics."""
    root = cache_root() / "blobs"
    count = 0
    size = 0
    try:
        for path in root.glob("*/*.src"):
            count += 1
            try:
                size += path.stat().st_size
            except OSError:
                pass
    except Exception:
        pass
    return {"entries": count, "bytes": size}
