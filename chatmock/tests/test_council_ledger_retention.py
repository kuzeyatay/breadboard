"""The council ledger prunes itself, so receipt lookups stay fast.

Without retention the ledger grew to 143k run snapshots on a developer
machine; `glob("crun_*.json")` then took minutes and receipt resolution timed
out on loopback, killing Learn runs.
"""

from __future__ import annotations

import os
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from chatmock.council import ledger as ledger_module
from chatmock.council.ledger import (
    _RETENTION_FLOOR_SECONDS,
    JsonlCouncilLedger,
    _retention_seconds,
)


def _write(path: Path, age_seconds: float) -> Path:
    path.write_text("{}", encoding="utf-8")
    stamp = time.time() - age_seconds
    os.utime(path, (stamp, stamp))
    return path


class CouncilLedgerRetentionTest(unittest.TestCase):
    def test_retention_never_drops_below_the_legacy_fence(self) -> None:
        # The legacy request fence spans at most 48h, so a shorter retention
        # could delete a run that fence still has to see.
        for value in ("0", "0.5", "-3", "not-a-number", ""):
            os.environ["COUNCIL_LEDGER_RETENTION_DAYS"] = value
            self.assertGreaterEqual(_retention_seconds(), _RETENTION_FLOOR_SECONDS)
        os.environ.pop("COUNCIL_LEDGER_RETENTION_DAYS", None)
        self.assertGreaterEqual(_retention_seconds(), 48 * 3600)

    def test_prune_removes_old_runs_and_keeps_recent_and_foreign_files(self) -> None:
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            ledger = JsonlCouncilLedger(base)
            old_run = _write(base / "crun_old.json", 30 * 24 * 3600)
            old_events = _write(base / "crun_old.events.jsonl", 30 * 24 * 3600)
            fresh_run = _write(base / "crun_fresh.json", 60)
            receipts = base / "request-receipts"
            receipts.mkdir()
            kept_receipt = _write(receipts / "crun_old.json", 30 * 24 * 3600)
            unrelated = _write(base / "notes.json", 30 * 24 * 3600)

            ledger._maybe_prune()

            self.assertFalse(old_run.exists(), "an expired run snapshot is dropped")
            self.assertFalse(old_events.exists(), "its event stream goes with it")
            self.assertTrue(fresh_run.exists(), "a run inside retention is kept")
            self.assertTrue(kept_receipt.exists(), "request receipts are not touched")
            self.assertTrue(unrelated.exists(), "non-crun files are not touched")

    def test_prune_is_rate_limited_so_saves_stay_cheap(self) -> None:
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            ledger = JsonlCouncilLedger(base)
            ledger._maybe_prune()
            late = _write(base / "crun_late.json", 30 * 24 * 3600)
            ledger._maybe_prune()  # inside the interval: must not sweep again
            self.assertTrue(late.exists(), "a second sweep waits for the interval")
            ledger._next_prune_at = 0.0
            ledger._maybe_prune()
            self.assertFalse(late.exists(), "the next interval sweeps it")

    def test_a_saturated_sweep_re_arms_instead_of_waiting_out_the_interval(self) -> None:
        # A budget-capped sweep per interval drains slower than a busy day
        # fills: the directory then grows despite retention being on, which is
        # how 143k snapshots accumulated in the first place.
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            ledger = JsonlCouncilLedger(base)
            expired = [
                _write(base / f"crun_{index}.json", 30 * 24 * 3600)
                for index in range(ledger_module._PRUNE_BUDGET + 3)
            ]

            ledger._maybe_prune()
            remaining = [path for path in expired if path.exists()]
            self.assertEqual(len(remaining), 3, "the sweep stops at its budget")
            self.assertEqual(ledger._next_prune_at, 0.0, "a saturated sweep re-arms immediately")

            ledger._maybe_prune()  # same interval, but the backlog is not drained
            self.assertFalse(any(path.exists() for path in expired), "back-to-back sweeps finish it")
            self.assertGreater(ledger._next_prune_at, 0.0, "a clean sweep falls back to the interval")


if __name__ == "__main__":
    unittest.main()
