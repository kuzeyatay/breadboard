from __future__ import annotations

import json
import multiprocessing
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from _local_package import load_local_package
from _platform_support import requires_fcntl_locks

load_local_package()
from omh.paths import resolve_paths
from omh.workflows.memory import (
    _memory_snapshots,
    apply_approved_memory_update_batch,
    apply_memory_update_batch,
    build_handoff_context_pack,
    review_memory_update_batch,
    stage_memory_update_batch,
)


def _batch(label: str, *, scope: dict[str, str] | None = None) -> dict[str, object]:
    return {
        "schema_version": "memory_update_batch/v1",
        "source_surface": "test",
        "updates": [
            {
                "op": "update",
                "item_id": label,
                "scope": scope or {"kind": "project", "ref": "default"},
                "key": label.replace("-", "_"),
                "value": f"value for {label}",
                "summary": f"Remember {label}",
            }
        ],
    }


def _apply_worker(home: str, batch_id: str, barrier: object, ready: object, queue: object) -> None:
    paths = resolve_paths(Path(home) / ".omh", Path(home) / ".hermes")
    ready.set()
    barrier.wait(timeout=10)
    result = apply_approved_memory_update_batch(paths, batch_id)
    queue.put((result["status"], result["batch_id"]))


class MemoryBatchTests(TestCase):
    def _stage_and_remember(self, paths, batch: dict[str, object]) -> dict[str, object]:
        staged = stage_memory_update_batch(paths, batch)
        decisions = {item["item_id"]: "remember" for item in staged["items"]}
        reviewed = review_memory_update_batch(paths, staged["batch_id"], decisions, reviewer_label="operator-label")
        self.assertEqual(reviewed["status"], "reviewed")
        return staged

    def test_legacy_direct_apply_is_review_required_and_write_free(self) -> None:
        with TemporaryDirectory() as home:
            paths = resolve_paths(Path(home) / ".omh", Path(home) / ".hermes")

            result = apply_memory_update_batch(paths, _batch("unreviewed-direct"))

            self.assertEqual(result["status"], "review_required")
            self.assertFalse(result["applied"])
            self.assertFalse(paths.memory_dir.exists())

    def test_stage_review_apply_binds_immutable_decisions_and_keeps_receipt_metadata_only(self) -> None:
        with TemporaryDirectory() as home:
            paths = resolve_paths(Path(home) / ".omh", Path(home) / ".hermes")
            staged = stage_memory_update_batch(paths, _batch("release-command"))
            self.assertEqual(apply_approved_memory_update_batch(paths, staged["batch_id"])["status"], "review_required")
            review_memory_update_batch(paths, staged["batch_id"], {staged["items"][0]["item_id"]: "remember"}, reviewer_label="operator-label")
            item = staged["items"][0]
            with self.assertRaisesRegex(ValueError, "immutable"):
                review_memory_update_batch(paths, staged["batch_id"], {item["item_id"]: "refuse"}, reviewer_label="operator-label")

            self.assertTrue(item["item_id"].startswith("item_"))
            self.assertEqual(item["retention_class"], "standard")
            self.assertTrue(staged["batch_id"].startswith("batch_"))
            self.assertNotIn(item["item_id"], {row["item_id"] for row in build_handoff_context_pack(paths)["included_context"]})

            applied = apply_approved_memory_update_batch(paths, staged["batch_id"])
            repeated = apply_approved_memory_update_batch(paths, staged["batch_id"])
            handoff = build_handoff_context_pack(paths)
            receipt = applied["receipt"]

            self.assertEqual(applied["status"], "applied")
            self.assertEqual(repeated["status"], "applied")
            self.assertIn(item["item_id"], [row["item_id"] for row in handoff["included_context"]])
            self.assertEqual(receipt["operation_id"], staged["operation_id"])
            self.assertNotIn("value", json.dumps(receipt))
            self.assertNotIn("summary", json.dumps(receipt))
            self.assertNotIn("hash", json.dumps(receipt))
            self.assertNotIn(str(paths.memory_dir), json.dumps(receipt))

    def test_stage_rejects_unsafe_content_without_writing_a_candidate(self) -> None:
        with TemporaryDirectory() as home:
            paths = resolve_paths(Path(home) / ".omh", Path(home) / ".hermes")
            unsafe = _batch("unsafe")
            unsafe["updates"][0]["value"] = "token=protected"

            with self.assertRaisesRegex(ValueError, "unsafe"):
                stage_memory_update_batch(paths, unsafe)

            self.assertFalse(paths.memory_dir.exists())

    def test_refused_or_deferred_items_never_write(self) -> None:
        with TemporaryDirectory() as home:
            paths = resolve_paths(Path(home) / ".omh", Path(home) / ".hermes")
            batch = _batch("remember")
            batch["updates"].append(
                {
                    "op": "update",
                    "item_id": "defer",
                    "scope": {"kind": "project", "ref": "default"},
                    "key": "defer",
                    "value": "value for defer",
                    "summary": "Remember defer",
                }
            )
            staged = stage_memory_update_batch(paths, batch)
            decisions = {staged["items"][0]["item_id"]: "remember", staged["items"][1]["item_id"]: "defer"}
            review_memory_update_batch(paths, staged["batch_id"], decisions, reviewer_label="operator-label")

            result = apply_approved_memory_update_batch(paths, staged["batch_id"])

            self.assertEqual(result["status"], "review_required")
            self.assertFalse((paths.memory_dir / "scopes").exists())

    def test_interrupted_apply_is_ineligible_until_exactly_once_recovery(self) -> None:
        with TemporaryDirectory() as home:
            paths = resolve_paths(Path(home) / ".omh", Path(home) / ".hermes")
            batch = _batch("project-item")
            batch["updates"].append(
                {
                    "op": "update",
                    "item_id": "thread-item",
                    "scope": {"kind": "thread", "ref": "thread-1"},
                    "key": "thread_item",
                    "value": "value for thread-item",
                    "summary": "Remember thread-item",
                }
            )
            staged = self._stage_and_remember(paths, batch)
            writes = 0

            def interrupt_on_second_write(_name: str) -> None:
                nonlocal writes
                writes += 1
                if writes == 2:
                    raise RuntimeError("injected named write interruption")

            with self.assertRaisesRegex(RuntimeError, "injected named write interruption"):
                apply_approved_memory_update_batch(paths, staged["batch_id"], write_hook=interrupt_on_second_write)

            interrupted = build_handoff_context_pack(paths)
            self.assertFalse({item["item_id"] for item in interrupted["included_context"]} & {row["item_id"] for row in staged["items"]})
            self.assertEqual(
                apply_approved_memory_update_batch(paths, staged["batch_id"])["status"],
                "applied",
            )
            recovered = build_handoff_context_pack(paths)
            ids = [item["item_id"] for item in recovered["included_context"]]
            self.assertTrue({row["item_id"] for row in staged["items"]} <= set(ids))

    def test_v1_scope_item_keeps_legacy_review_reason(self) -> None:
        with TemporaryDirectory() as home:
            paths = resolve_paths(Path(home) / ".omh", Path(home) / ".hermes")
            scope_path = paths.memory_dir / "scopes" / "project.json"
            scope_path.parent.mkdir(parents=True)
            scope_path.write_text(
                json.dumps(
                    {
                        "schema_version": "omh_memory_scope/v1",
                        "scope": {"kind": "project", "ref": "default"},
                        "items": {"legacy-item": {"item_id": "legacy-item", "key": "legacy", "summary": "Legacy item", "value": "legacy value"}},
                    }
                ),
                encoding="utf-8",
            )

            item = next(item for snapshot in _memory_snapshots(paths) for item in snapshot["items"] if item["item_id"] == "legacy-item")

            self.assertEqual(item["replay_evaluation"]["reason_code"], "review_required_legacy")

    @requires_fcntl_locks
    def test_two_process_apply_serializes_same_scope_and_preserves_different_scopes(self) -> None:
        for distinct_scopes in (False, True):
            with self.subTest(distinct_scopes=distinct_scopes), TemporaryDirectory() as home:
                paths = resolve_paths(Path(home) / ".omh", Path(home) / ".hermes")
                first = self._stage_and_remember(paths, _batch("first-item"))
                second_scope = {"kind": "thread", "ref": "thread-2"} if distinct_scopes else None
                second = self._stage_and_remember(paths, _batch("second-item", scope=second_scope))
                context = multiprocessing.get_context("spawn")
                barrier = context.Barrier(3)
                first_ready, second_ready, queue = context.Event(), context.Event(), context.Queue()
                workers = [
                    context.Process(target=_apply_worker, args=(home, staged["batch_id"], barrier, ready, queue))
                    for staged, ready in ((first, first_ready), (second, second_ready))
                ]
                for worker in workers:
                    worker.start()
                self.assertTrue(first_ready.wait(timeout=10))
                self.assertTrue(second_ready.wait(timeout=10))
                barrier.wait(timeout=10)
                for worker in workers:
                    worker.join(timeout=10)
                    self.assertEqual(worker.exitcode, 0)
                self.assertCountEqual([queue.get(timeout=2), queue.get(timeout=2)], [("applied", first["batch_id"]), ("applied", second["batch_id"])])
                ids = {item["item_id"] for item in build_handoff_context_pack(paths)["included_context"]}
                self.assertTrue({first["items"][0]["item_id"], second["items"][0]["item_id"]} <= ids)
