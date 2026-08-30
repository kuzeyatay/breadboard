from __future__ import annotations

import json
import os
import stat
import threading
import unittest
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from _local_package import load_local_package

load_local_package()
from omh.maintenance.doctor import _awareness_delivery_check
from omh.paths import resolve_paths
from omh.plugin_bundle.omh.awareness_delivery import (
    AWARENESS_DELIVERY_SCHEMA_VERSION,
    _awareness_delivery_lock,
    awareness_delivery_path,
    read_awareness_delivery,
    record_awareness_delivery,
)


class AwarenessDeliveryLedgerTests(unittest.TestCase):
    """Whether OMH's awareness hook returned a payload for model input.

    Nothing recorded this. `host_observation` drops a record unless the caller
    supplies `host` and `session_id`, and Hermes passes neither to
    `pre_llm_call`, so its ledger sat at eight rows from a single day while live
    turns kept running. Hermes also swallows hook exceptions with a log warning.
    Awareness could be dead for weeks and the only symptom would be a user
    learning to type "load OMH" by hand.
    """

    def test_an_empty_ledger_reads_as_zero(self) -> None:
        with TemporaryDirectory() as tmp:
            record = read_awareness_delivery(tmp)
            self.assertEqual(record["delivery_count"], 0)
            self.assertEqual(record["route_hint_count"], 0)
            self.assertEqual(record["last_delivered_at"], "")
            self.assertFalse(record["unreadable"])

    def test_a_delivery_is_counted_with_its_size(self) -> None:
        with TemporaryDirectory() as tmp:
            record_awareness_delivery(
                delivered=True, route_hint=True, context_chars=2768,
                observed_at="2026-07-26T04:28:50Z", omh_home=tmp,
            )
            record = read_awareness_delivery(tmp)
            self.assertEqual(record["delivery_count"], 1)
            self.assertEqual(record["route_hint_count"], 1)
            self.assertEqual(record["last_context_chars"], 2768)
            self.assertEqual(record["first_delivered_at"], "2026-07-26T04:28:50Z")
            self.assertEqual(record["schema_version"], AWARENESS_DELIVERY_SCHEMA_VERSION)

    def test_a_turn_with_nothing_to_inject_is_counted_separately(self) -> None:
        """"Ran and had nothing to say" must not look like "never ran"."""
        with TemporaryDirectory() as tmp:
            record_awareness_delivery(
                delivered=False, route_hint=False, context_chars=0,
                observed_at="2026-07-26T04:27:20Z", omh_home=tmp,
            )
            record = read_awareness_delivery(tmp)
            self.assertEqual(record["suppressed_count"], 1)
            self.assertEqual(record["delivery_count"], 0)
            self.assertEqual(record["last_delivered_at"], "")
            self.assertEqual(record["first_attempted_at"], "2026-07-26T04:27:20Z")

    def test_route_hints_are_counted_only_when_present(self) -> None:
        with TemporaryDirectory() as tmp:
            for hint in (False, True, False):
                record_awareness_delivery(
                    delivered=True, route_hint=hint, context_chars=100,
                    observed_at="2026-07-26T04:30:00Z", omh_home=tmp,
                )
            record = read_awareness_delivery(tmp)
            self.assertEqual(record["delivery_count"], 3)
            self.assertEqual(record["route_hint_count"], 1)

    def test_first_delivered_at_is_kept_and_last_moves(self) -> None:
        with TemporaryDirectory() as tmp:
            record_awareness_delivery(
                delivered=True, route_hint=False, context_chars=10,
                observed_at="2026-07-26T01:00:00Z", omh_home=tmp,
            )
            record_awareness_delivery(
                delivered=True, route_hint=False, context_chars=20,
                observed_at="2026-07-26T02:00:00Z", omh_home=tmp,
            )
            record = read_awareness_delivery(tmp)
            self.assertEqual(record["first_delivered_at"], "2026-07-26T01:00:00Z")
            self.assertEqual(record["last_delivered_at"], "2026-07-26T02:00:00Z")

    def test_the_file_has_a_fixed_shape_and_cannot_grow(self) -> None:
        """Counters, not an append-only log.

        A per-turn log on the hottest path is how a journal reached ~4.7k rows
        of test noise. This runs on every LLM call, so its size must not depend
        on how many calls happened.
        """
        with TemporaryDirectory() as tmp:
            for index in range(50):
                record_awareness_delivery(
                    delivered=True, route_hint=True, context_chars=index,
                    observed_at="2026-07-26T04:30:00Z", omh_home=tmp,
                )
            size_after_50 = awareness_delivery_path(tmp).stat().st_size
            for index in range(200):
                record_awareness_delivery(
                    delivered=True, route_hint=True, context_chars=index,
                    observed_at="2026-07-26T04:31:00Z", omh_home=tmp,
                )
            size_after_250 = awareness_delivery_path(tmp).stat().st_size
            self.assertEqual(read_awareness_delivery(tmp)["delivery_count"], 250)
            self.assertLess(abs(size_after_250 - size_after_50), 40)

    def test_no_prompt_text_is_ever_stored(self) -> None:
        with TemporaryDirectory() as tmp:
            record_awareness_delivery(
                delivered=True, route_hint=True, context_chars=2768,
                observed_at="2026-07-26T04:28:50Z", omh_home=tmp,
            )
            written = awareness_delivery_path(tmp).read_text(encoding="utf-8")
            stored = json.loads(written)
            self.assertEqual(
                set(stored),
                {
                    "schema_version", "delivery_count", "route_hint_count", "suppressed_count",
                    "first_attempted_at", "first_delivered_at", "last_delivered_at", "last_context_chars",
                },
            )
            self.assertNotIn("2768 chars of prompt", written)
            for key in ("context", "user_message", "prompt", "route_hint"):
                self.assertNotIn(key, stored, f"{key} would put model-facing text in a ledger")

    def test_zero_delivery_warns_only_after_seven_days(self) -> None:
        with TemporaryDirectory() as tmp:
            paths = resolve_paths(Path(tmp) / ".omh", Path(tmp) / ".hermes")
            record_awareness_delivery(
                delivered=False,
                route_hint=False,
                context_chars=0,
                observed_at="2026-07-01T00:00:00Z",
                omh_home=str(paths.omh_home),
            )

            fresh = _awareness_delivery_check(
                paths,
                now=datetime(2026, 7, 7, 23, 59, 59, tzinfo=UTC),
            )
            aged = _awareness_delivery_check(
                paths,
                now=datetime(2026, 7, 8, 0, 0, 0, tzinfo=UTC),
            )

            self.assertTrue(fresh.ok)
            self.assertEqual(fresh.severity, "ok")
            self.assertFalse(aged.ok)
            self.assertEqual(aged.severity, "warning")
            self.assertIn("restart hermes", aged.next_action.casefold())
            self.assertEqual(aged.remediation, aged.next_action)
            self.assertIn("for at least 7 days", aged.message)
            self.assertIn("hook payload", aged.message)
            self.assertNotIn("reached a model", aged.message)

    def test_a_delivery_or_legacy_record_never_false_ages(self) -> None:
        with TemporaryDirectory() as tmp:
            paths = resolve_paths(Path(tmp) / ".omh", Path(tmp) / ".hermes")
            record_awareness_delivery(
                delivered=True,
                route_hint=True,
                context_chars=12,
                observed_at="2026-07-01T00:00:00Z",
                omh_home=str(paths.omh_home),
            )
            delivered = _awareness_delivery_check(
                paths,
                now=datetime(2026, 8, 1, tzinfo=UTC),
            )
            self.assertTrue(delivered.ok)
            self.assertIn("hook payload", delivered.message)
            self.assertNotIn("reached a model", delivered.message)

            awareness_delivery_path(str(paths.omh_home)).write_text(
                json.dumps(
                    {
                        "schema_version": AWARENESS_DELIVERY_SCHEMA_VERSION,
                        "delivery_count": 0,
                        "route_hint_count": 0,
                        "suppressed_count": 5,
                    }
                ),
                encoding="utf-8",
            )
            legacy = _awareness_delivery_check(
                paths,
                now=datetime(2026, 8, 1, tzinfo=UTC),
            )
            self.assertTrue(legacy.ok)
            self.assertEqual(legacy.severity, "ok")

    @unittest.skipUnless(os.name == "posix", "POSIX mode bits do not exist off POSIX")
    def test_ledger_file_and_directory_are_private(self) -> None:
        with TemporaryDirectory() as tmp:
            record_awareness_delivery(
                delivered=False,
                route_hint=False,
                context_chars=0,
                observed_at="2026-07-01T00:00:00Z",
                omh_home=tmp,
            )
            path = awareness_delivery_path(tmp)
            self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_a_corrupt_ledger_reads_as_unreadable_rather_than_zero(self) -> None:
        """Zero deliveries and an unparseable file mean different things."""
        with TemporaryDirectory() as tmp:
            path = awareness_delivery_path(tmp)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{not json", encoding="utf-8")
            record = read_awareness_delivery(tmp)
            self.assertTrue(record["unreadable"])
            self.assertEqual(record["delivery_count"], 0)

    def test_semantically_corrupt_ledger_is_unreadable_and_repaired(self) -> None:
        with TemporaryDirectory() as tmp:
            paths = resolve_paths(Path(tmp) / ".omh", Path(tmp) / ".hermes")
            path = awareness_delivery_path(str(paths.omh_home))
            path.parent.mkdir(parents=True)
            path.write_text(
                json.dumps(
                    {
                        "schema_version": AWARENESS_DELIVERY_SCHEMA_VERSION,
                        "delivery_count": "many",
                        "route_hint_count": 0,
                        "suppressed_count": 0,
                        "first_attempted_at": [],
                        "last_context_chars": -1,
                    }
                ),
                encoding="utf-8",
            )

            self.assertTrue(read_awareness_delivery(str(paths.omh_home))["unreadable"])
            self.assertEqual(_awareness_delivery_check(paths).severity, "warning")
            repaired = record_awareness_delivery(
                delivered=True,
                route_hint=False,
                context_chars=12,
                observed_at="2026-07-01T00:00:00Z",
                omh_home=str(paths.omh_home),
            )

            self.assertIsNotNone(repaired)
            self.assertEqual(read_awareness_delivery(str(paths.omh_home))["delivery_count"], 1)

    def test_delivery_lock_serializes_concurrent_writers(self) -> None:
        with TemporaryDirectory() as tmp:
            path = awareness_delivery_path(tmp)
            contender_started = threading.Event()
            contender_acquired = threading.Event()

            def contend() -> None:
                contender_started.set()
                with _awareness_delivery_lock(path):
                    contender_acquired.set()

            with _awareness_delivery_lock(path):
                thread = threading.Thread(target=contend)
                thread.start()
                self.assertTrue(contender_started.wait(timeout=1))
                self.assertFalse(contender_acquired.is_set())
            self.assertTrue(contender_acquired.wait(timeout=1))
            thread.join(timeout=1)
            self.assertFalse(thread.is_alive())

    def test_a_write_failure_never_raises(self) -> None:
        """Losing a counter is fine; breaking the hook that feeds the model is not."""
        with TemporaryDirectory() as tmp:
            with patch.object(Path, "mkdir", side_effect=OSError("read-only")):
                self.assertIsNone(
                    record_awareness_delivery(
                        delivered=True, route_hint=True, context_chars=10,
                        observed_at="2026-07-26T04:30:00Z", omh_home=tmp,
                    )
                )


if __name__ == "__main__":
    unittest.main()
