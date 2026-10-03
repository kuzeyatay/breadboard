from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from .types import CouncilRun, EvolutionNode, now_iso

# Retention. The ledger had none, so it grew without bound: on one developer
# machine it reached 143k run snapshots, where a single `glob("crun_*.json")`
# (see request_receipts.legacy resolution) takes minutes and a receipt lookup
# on loopback times out, killing whole Learn runs. Runs are spent records once
# nothing can still fence against them; the legacy request fence is itself
# capped at 48 hours, so anything older than the window below cannot be needed.
_RETENTION_FLOOR_SECONDS = 3 * 24 * 3600


def _retention_seconds() -> float:
    raw = (os.environ.get("COUNCIL_LEDGER_RETENTION_DAYS") or "").strip()
    try:
        days = float(raw) if raw else 7.0
    except ValueError:
        days = 7.0
    return max(_RETENTION_FLOOR_SECONDS, days * 24 * 3600)


def _prune_interval_seconds() -> float:
    raw = (os.environ.get("COUNCIL_LEDGER_PRUNE_INTERVAL_SECONDS") or "").strip()
    try:
        return max(60.0, float(raw)) if raw else 3600.0
    except ValueError:
        return 3600.0


#: Deletions attempted per sweep. A sweep runs inline on a save, so it stays
#: small enough to be invisible next to the model call that produced the run.
_PRUNE_BUDGET = 500

# Ledger event types
EVENT_RUN_CREATED = "council_run_created"
EVENT_CANDIDATE_GENERATED = "council_candidate_generated"
EVENT_REVIEW_COMPLETED = "council_review_completed"
EVENT_FINAL_SYNTHESIZED = "council_final_synthesized"
EVENT_RUN_FAILED = "council_run_failed"


def default_ledger_dir() -> Path:
    # <repo root>/.breadboard/council-runs — this file lives at
    # <repo root>/chatmock/chatmock/council/ledger.py
    return Path(__file__).resolve().parents[3] / ".breadboard" / "council-runs"


class CouncilLedger:
    """Persistence interface. Swap the implementation for DB storage later.

    Implementations must never raise into the caller: a broken ledger must not
    block a user response.
    """

    def record_event(self, run_id: str, event_type: str, data: Optional[Dict[str, Any]] = None) -> None:
        raise NotImplementedError

    def save_run(self, run: CouncilRun) -> None:
        raise NotImplementedError

    def save_evolution_node(self, node: EvolutionNode) -> None:
        raise NotImplementedError


class JsonlCouncilLedger(CouncilLedger):
    """Dev-mode ledger: JSONL event streams + JSON run snapshots on disk."""

    def __init__(self, base_dir: str | Path | None = None) -> None:
        self.base_dir = Path(base_dir) if base_dir else default_ledger_dir()
        self._lock = threading.Lock()
        self._prune_lock = threading.Lock()
        self._next_prune_at = 0.0

    def _maybe_prune(self) -> None:
        """Drop run snapshots and event streams past the retention window.

        Inline and bounded: at most `_PRUNE_BUDGET` deletions, at most once per
        prune interval, and never raising - a ledger must not break a caller.
        Only `crun_*` runs are touched; request receipts and evolution nodes
        live in their own subdirectories and are left alone.
        """
        now = time.time()
        with self._prune_lock:
            if now < self._next_prune_at:
                return
            self._next_prune_at = now + _prune_interval_seconds()
        cutoff = now - _retention_seconds()
        removed = 0
        try:
            with os.scandir(self.base_dir) as entries:
                for entry in entries:
                    if removed >= _PRUNE_BUDGET:
                        break
                    name = entry.name
                    if not name.startswith("crun_"):
                        continue
                    if not (name.endswith(".json") or name.endswith(".events.jsonl")):
                        continue
                    try:
                        if not entry.is_file() or entry.stat().st_mtime >= cutoff:
                            continue
                        os.remove(entry.path)
                        removed += 1
                    except FileNotFoundError:
                        continue
                    except Exception:
                        # A file held open elsewhere is retried next sweep.
                        continue
        except Exception as exc:
            self._warn(f"could not prune the council ledger: {exc}")
            return
        if removed >= _PRUNE_BUDGET:
            # The sweep hit its ceiling, so more is already past retention.
            # Waiting a full interval would cap the drain at _PRUNE_BUDGET per
            # interval, which a busy day out-runs: the directory then grows
            # despite retention being on. Re-arm immediately instead, so
            # sweeps run back to back until the backlog is gone and fall back
            # to the interval once it is.
            with self._prune_lock:
                self._next_prune_at = 0.0
        if removed:
            self._warn(f"pruned {removed} council ledger entries older than retention")

    def _warn(self, message: str) -> None:
        try:
            print(f"[CouncilLedger] warning: {message}")
        except Exception:
            pass

    def _ensure_dir(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)

    def record_event(self, run_id: str, event_type: str, data: Optional[Dict[str, Any]] = None) -> None:
        try:
            self._ensure_dir(self.base_dir)
            entry = {
                "runId": run_id,
                "type": event_type,
                "at": now_iso(),
                "data": data or {},
            }
            line = json.dumps(entry, ensure_ascii=False, default=str)
            with self._lock:
                with open(self.base_dir / f"{run_id}.events.jsonl", "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
        except Exception as exc:
            self._warn(f"could not record event {event_type} for {run_id}: {exc}")

    def save_run(self, run: CouncilRun) -> None:
        try:
            self._ensure_dir(self.base_dir)
            payload = json.dumps(run.to_dict(), ensure_ascii=False, indent=2, default=str)
            with self._lock:
                (self.base_dir / f"{run.id}.json").write_text(payload, encoding="utf-8")
        except Exception as exc:
            self._warn(f"could not save run {run.id}: {exc}")
        # After the write, so a prune failure can never lose the run itself.
        self._maybe_prune()

    def save_evolution_node(self, node: EvolutionNode) -> None:
        try:
            evo_dir = self.base_dir / "evolution"
            self._ensure_dir(evo_dir)
            payload = json.dumps(node.to_dict(), ensure_ascii=False, indent=2, default=str)
            with self._lock:
                (evo_dir / f"{node.id}.json").write_text(payload, encoding="utf-8")
        except Exception as exc:
            self._warn(f"could not save evolution node {node.id}: {exc}")


class NullCouncilLedger(CouncilLedger):
    """No-op ledger (used only if the filesystem ledger cannot be created)."""

    def record_event(self, run_id: str, event_type: str, data: Optional[Dict[str, Any]] = None) -> None:
        return None

    def save_run(self, run: CouncilRun) -> None:
        return None

    def save_evolution_node(self, node: EvolutionNode) -> None:
        return None
