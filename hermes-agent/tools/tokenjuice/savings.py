"""What compression saved, recorded so something can report it.

Hermes records tokens, not dollars. It knows how much text it stopped from
reaching the model and which model was being spoken to; it does not own a
price table, and duplicating one here would be a second copy to keep correct.
The dashboard already prices replies for the profile cost card, so it prices
these too.

Two files under ``$HERMES_HOME/tokenjuice/``:

``savings.jsonl``  append-only, one line per compression, for auditing.
``savings.json``   a rolled-up total, rewritten atomically, so a reader gets
                   the whole picture from one small file.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# The same rough ratio the context estimator uses (agent/model_metadata.py).
# Deliberately not per-tokeniser: this is a savings report, not a budget, and
# an exact count would cost a tokeniser load on every tool call.
CHARS_PER_TOKEN = 4

_lock = threading.Lock()

# Keep the audit log from growing without bound on a long-running install.
_MAX_LEDGER_BYTES = 8 * 1024 * 1024


def _root() -> Path:
    from tools.tokenjuice.cache import cache_root

    return cache_root()


def _write_atomic(path: Path, data: str) -> None:
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


def _empty_summary() -> Dict[str, Any]:
    return {
        "compressions": 0,
        "originalChars": 0,
        "keptChars": 0,
        "savedChars": 0,
        "savedTokens": 0,
        "charsPerToken": CHARS_PER_TOKEN,
        "byFormat": {},
        "byTool": {},
        "byModel": {},
        "firstAt": None,
        "lastAt": None,
    }


def _bump(bucket: Dict[str, Any], key: str, saved_chars: int, saved_tokens: int) -> None:
    slot = bucket.setdefault(key, {"compressions": 0, "savedChars": 0, "savedTokens": 0})
    slot["compressions"] += 1
    slot["savedChars"] += saved_chars
    slot["savedTokens"] += saved_tokens


def record(
    *,
    tool_name: str,
    fmt: str,
    original_chars: int,
    kept_chars: int,
    handle: str,
    model: Optional[str] = None,
) -> None:
    """Record one compression. Never raises — reporting must not break a turn."""
    saved_chars = max(0, original_chars - kept_chars)
    if saved_chars <= 0:
        return
    saved_tokens = saved_chars // CHARS_PER_TOKEN
    now = time.time()
    model_id = (model or os.environ.get("HERMES_ACTIVE_MODEL") or "unknown").strip() or "unknown"

    entry = {
        "ts": now,
        "tool": tool_name,
        "format": fmt,
        "handle": handle,
        "originalChars": original_chars,
        "keptChars": kept_chars,
        "savedChars": saved_chars,
        "savedTokens": saved_tokens,
        "model": model_id,
    }

    try:
        with _lock:
            root = _root()
            root.mkdir(parents=True, exist_ok=True)
            ledger = root / "savings.jsonl"
            _rotate_if_large(ledger)
            with ledger.open("a", encoding="utf-8", newline="") as handle_file:
                handle_file.write(json.dumps(entry, ensure_ascii=False) + "\n")

            summary = _load_summary_unlocked(root)
            summary["compressions"] += 1
            summary["originalChars"] += original_chars
            summary["keptChars"] += kept_chars
            summary["savedChars"] += saved_chars
            summary["savedTokens"] += saved_tokens
            _bump(summary["byFormat"], fmt, saved_chars, saved_tokens)
            _bump(summary["byTool"], tool_name, saved_chars, saved_tokens)
            _bump(summary["byModel"], model_id, saved_chars, saved_tokens)
            if not summary.get("firstAt"):
                summary["firstAt"] = now
            summary["lastAt"] = now
            _write_atomic(root / "savings.json", json.dumps(summary, ensure_ascii=False))
    except Exception as exc:
        logger.debug("TokenJuice savings record failed: %s", exc)


def _rotate_if_large(ledger: Path) -> None:
    try:
        if ledger.exists() and ledger.stat().st_size > _MAX_LEDGER_BYTES:
            ledger.replace(ledger.with_suffix(".jsonl.1"))
    except OSError:
        pass


def _load_summary_unlocked(root: Path) -> Dict[str, Any]:
    try:
        loaded = json.loads((root / "savings.json").read_text(encoding="utf-8"))
    except Exception:
        return _empty_summary()
    if not isinstance(loaded, dict):
        return _empty_summary()
    base = _empty_summary()
    base.update(loaded)
    for key in ("byFormat", "byTool", "byModel"):
        if not isinstance(base.get(key), dict):
            base[key] = {}
    return base


def summary() -> Dict[str, Any]:
    """The rolled-up totals. Returns an empty summary when nothing is recorded."""
    with _lock:
        return _load_summary_unlocked(_root())


def reset() -> None:
    """Clear the ledger — for tests."""
    with _lock:
        root = _root()
        for name in ("savings.jsonl", "savings.jsonl.1", "savings.json"):
            try:
                (root / name).unlink()
            except OSError:
                pass
