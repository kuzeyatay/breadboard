from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from .types import CouncilRun, EvolutionNode, now_iso

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
