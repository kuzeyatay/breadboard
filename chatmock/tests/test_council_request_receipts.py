from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import call, patch

from chatmock import ask
from chatmock.app import create_app
from chatmock.council import request_receipts as request_receipts_module
from chatmock.council.ledger import JsonlCouncilLedger
from chatmock.council.policy import CouncilConfig
from chatmock.council.request_receipts import (
    CouncilReceiptConflict,
    CouncilReceiptCorrupt,
    StrictCouncilReceiptStore,
    canonical_json_v1,
    council_request_hash_v1,
    default_receipt_store,
    legacy_completed_inventory,
    legacy_completed_matches,
    legacy_run_hash_v1,
)
from chatmock.council.runtime import CouncilRuntime
from chatmock.council.types import CouncilInput
from chatmock.providers.registry import resolve_model
from chatmock.providers.types import ModelTokenUsage, ProviderError


ROOT = Path(__file__).resolve().parents[2]
GOLDEN = Path(__file__).resolve().parent / "fixtures" / "council_request_hash_v1.json"


class OneCallRouter:
    def __init__(self) -> None:
        self.calls = 0
        self.strict_calls = 0

    def _answer(self, call) -> str:
        self.calls += 1
        resolved = resolve_model(call.model)
        call.model_attempts_out = [
            {
                "schemaVersion": 1,
                "at": "2030-01-01T00:00:01Z",
                "requestId": call.request_id,
                "endpoint": "council",
                "requestedModel": call.client_requested_model,
                "resolvedModel": resolved.public_model,
                "upstreamModel": resolved.upstream_model,
                "provider": resolved.provider.id,
                "outcome": "succeeded",
                "fallback": False,
            }
        ]
        call.usage_out = ModelTokenUsage(
            input_tokens=10,
            output_tokens=5,
            total_tokens=15,
        )
        return '{"fixture":true}'

    def effective_model(self, model: str) -> str:
        return model

    def call_model(self, call) -> str:
        return self._answer(call)

    def call_model_strict(self, call) -> str:
        self.strict_calls += 1
        return self._answer(call)


class SequencedStrictRouter:
    def __init__(self, outcomes: list[str]) -> None:
        self.outcomes = list(outcomes)
        self.calls = 0
        self.strict_calls = 0

    def effective_model(self, model: str) -> str:
        return model

    def call_model(self, call) -> str:
        return self.call_model_strict(call)

    def call_model_strict(self, call) -> str:
        self.calls += 1
        self.strict_calls += 1
        outcome = self.outcomes.pop(0)
        resolved = resolve_model(call.model)
        failed = outcome == "fail"
        call.model_attempts_out = [
            {
                "schemaVersion": 1,
                "at": f"2030-01-01T00:00:0{self.calls}Z",
                "requestId": call.request_id,
                "endpoint": "council",
                "requestedModel": call.client_requested_model,
                "resolvedModel": resolved.public_model,
                "upstreamModel": resolved.upstream_model,
                "provider": resolved.provider.id,
                "outcome": "failed" if failed else "succeeded",
                "fallback": False,
                **(
                    {
                        "statusCode": 502,
                        "errorCode": "upstream_unavailable",
                        "failurePhase": "connect",
                        "partialOutput": False,
                        "replaySafe": True,
                    }
                    if failed
                    else {}
                ),
            }
        ]
        call.usage_out = ModelTokenUsage(
            input_tokens=10,
            output_tokens=0 if failed else 5,
            total_tokens=10 if failed else 15,
        )
        if failed:
            raise ProviderError(
                "fixture upstream unavailable",
                phase="connect",
                partial_output=False,
                replay_safe=True,
            )
        return outcome


def fixture_input() -> CouncilInput:
    return CouncilInput(
        messages=[
            {"role": "system", "content": "Receipt test system"},
            {"role": "user", "content": "Receipt test user"},
        ],
        task_type="source_map",
        council_mode_override="direct_council",
        garden_id="fixture-garden",
        source_context={"stage": "fixture"},
        requested_model_alias="gpt-fixture",
        requested_model="gpt-fixture",
        resolved_model="gpt-fixture",
        reasoning_effort="max",
        reasoning_summary="detailed",
    )


def receipt_accounting(
    run_id: str,
    *,
    answer: str = "",
) -> dict[str, object]:
    failed = not answer.strip()
    return {
        "councilRunId": run_id,
        "councilMode": "direct_council",
        "requestedModel": "gpt-fixture",
        "resolvedModel": "gpt-fixture",
        "finalAnswer": answer,
        "usage": {
            "inputTokens": 10,
            "outputTokens": 5,
            "totalTokens": 15,
            "cachedInputTokens": 0,
            "reasoningTokens": 0,
            "callCount": 1,
            "reportedCallCount": 1,
        },
        "usageEstimated": False,
        "modelRouting": [
            {
                "schemaVersion": 1,
                "at": "2030-01-01T00:00:01Z",
                "requestId": run_id,
                "endpoint": "council",
                "requestedModel": "gpt-fixture",
                "resolvedModel": "gpt-fixture",
                "upstreamModel": "gpt-fixture",
                "provider": "chatgpt",
                "outcome": "failed" if failed else "succeeded",
                "fallback": False,
                **(
                    {
                        "statusCode": 502,
                        "errorCode": "upstream_unavailable",
                        "failurePhase": "connect",
                        "partialOutput": False,
                        "replaySafe": True,
                    }
                    if failed
                    else {}
                ),
            }
        ],
        "responseHash": hashlib.sha256(answer.encode("utf-8")).hexdigest(),
        "createdAt": "2030-01-01T00:00:00Z",
        "updatedAt": "2030-01-01T00:00:01Z",
    }


class CanonicalCouncilRequestTests(unittest.TestCase):
    def test_python_matches_shared_golden_fixture(self) -> None:
        fixture = json.loads(GOLDEN.read_text(encoding="utf-8"))
        digest = hashlib.sha256(
            canonical_json_v1(fixture["envelope"]).encode("utf-8")
        ).hexdigest()
        self.assertEqual(digest, fixture["expectedHash"])

    def test_number_domain_matches_javascript_safe_integer_rules(self) -> None:
        self.assertEqual(canonical_json_v1({"value": 1.0}), canonical_json_v1({"value": 1}))
        self.assertEqual(canonical_json_v1({"value": -0.0}), canonical_json_v1({"value": 0}))
        with self.assertRaises(ValueError):
            canonical_json_v1({"value": 9_007_199_254_740_992})
        with self.assertRaises(ValueError):
            canonical_json_v1({"value": float(9_007_199_254_740_992)})


class StrictCouncilReceiptStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = StrictCouncilReceiptStore(self.tmp.name)
        self.request_id = "lrq_fixture_request_0001"
        self.request_hash = "a" * 64

    def test_started_is_exclusive_and_completed_is_promptless(self) -> None:
        self.store.reserve(self.request_id, self.request_hash)
        with self.assertRaises(CouncilReceiptConflict):
            self.store.reserve(self.request_id, self.request_hash)
        completed = self.store.complete(
            self.request_id,
            self.request_hash,
            {
                **receipt_accounting("crun_fixture", answer='{"ok":true}'),
                "finalAnswer": '{"ok":true}',
            },
        )
        self.assertEqual(completed["state"], "completed")
        self.assertNotIn("messages", completed)
        self.assertNotIn("sourceContext", completed)

    def test_torn_receipt_is_ambiguity(self) -> None:
        Path(self.tmp.name, f"{self.request_id}.json").write_text("{", encoding="utf-8")
        with self.assertRaises(CouncilReceiptCorrupt):
            self.store.read(self.request_id, self.request_hash)
        with self.assertRaises(CouncilReceiptCorrupt):
            self.store.reserve(self.request_id, self.request_hash)

    def test_reserve_fsyncs_directory_before_return(self) -> None:
        with patch.object(self.store, "_fsync_dir") as fsync_dir:
            self.store.reserve(self.request_id, self.request_hash)
        fsync_dir.assert_called_once_with()

    def test_reserve_fsyncs_parents_of_new_receipt_directory_chain(self) -> None:
        nested = Path(self.tmp.name, "new-parent", "new-receipts")
        store = StrictCouncilReceiptStore(nested)
        with patch.object(store, "_fsync_directory_path") as fsync_path:
            store.reserve("lrq_fixture_nested_0001", self.request_hash)
        self.assertIn(call(Path(self.tmp.name)), fsync_path.call_args_list)
        self.assertIn(call(Path(self.tmp.name, "new-parent")), fsync_path.call_args_list)
        self.assertEqual(fsync_path.call_args_list[-1], call(nested))

    def _failed(self, request_id: str) -> dict[str, object]:
        self.store.reserve(
            request_id,
            self.request_hash,
            dispatch_mode="direct_council",
        )
        return self.store.fail_no_final_answer(
            request_id,
            self.request_hash,
            receipt_accounting(f"crun_{request_id}"),
        )

    def test_failed_receipt_claim_is_one_cross_instance_cas(self) -> None:
        request_id = "lrq_fixture_concurrent_0001"
        self._failed(request_id)
        barrier = threading.Barrier(2)

        def claim() -> str:
            contender = StrictCouncilReceiptStore(self.tmp.name)
            barrier.wait()
            try:
                contender.claim_failed_redispatch(request_id, self.request_hash)
                return "claimed"
            except CouncilReceiptConflict:
                return "conflict"

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _index: claim(), range(2)))
        self.assertCountEqual(outcomes, ["claimed", "conflict"])
        receipt = self.store.read(request_id, self.request_hash)
        self.assertEqual(receipt["state"], "started")
        self.assertEqual(receipt["dispatchCount"], 2)
        self.assertEqual(receipt["redispatchCount"], 1)
        self.assertTrue(
            Path(self.tmp.name, f"{request_id}.redispatch.json").exists()
        )

    def test_redispatch_refuses_hash_started_completed_and_corrupt(self) -> None:
        failed_id = "lrq_fixture_refuse_failed_0001"
        self._failed(failed_id)
        with self.assertRaises(CouncilReceiptConflict):
            self.store.claim_failed_redispatch(failed_id, "b" * 64)

        started_id = "lrq_fixture_refuse_started_0001"
        self.store.reserve(started_id, self.request_hash)
        with self.assertRaises(CouncilReceiptConflict):
            self.store.claim_failed_redispatch(started_id, self.request_hash)

        completed_id = "lrq_fixture_refuse_complete_0001"
        self.store.reserve(completed_id, self.request_hash)
        answer = '{"done":true}'
        self.store.complete(
            completed_id,
            self.request_hash,
            {
                **receipt_accounting(f"crun_{completed_id}", answer=answer),
                "finalAnswer": answer,
            },
        )
        with self.assertRaises(CouncilReceiptConflict):
            self.store.claim_failed_redispatch(completed_id, self.request_hash)

        corrupt_id = "lrq_fixture_refuse_corrupt_0001"
        Path(self.tmp.name, f"{corrupt_id}.json").write_text("{", encoding="utf-8")
        with self.assertRaises(CouncilReceiptCorrupt):
            self.store.claim_failed_redispatch(corrupt_id, self.request_hash)

    def test_claim_transition_crash_consumes_authority_without_dispatch(self) -> None:
        request_id = "lrq_fixture_claim_crash_0001"
        self._failed(request_id)
        with (
            patch.object(self.store, "_replace", side_effect=OSError("fixture crash")),
            self.assertRaises(OSError),
        ):
            self.store.claim_failed_redispatch(request_id, self.request_hash)

        recovered = StrictCouncilReceiptStore(self.tmp.name)
        receipt = recovered.read(request_id, self.request_hash)
        self.assertEqual(receipt["state"], "failed")
        metadata = recovered.promptless_metadata(
            request_id,
            self.request_hash,
            receipt,
        )
        self.assertFalse(metadata["redispatchAllowed"])
        with self.assertRaises(CouncilReceiptConflict):
            recovered.claim_failed_redispatch(request_id, self.request_hash)

    def test_torn_claim_is_ambiguity_not_new_authority(self) -> None:
        request_id = "lrq_fixture_torn_claim_0001"
        self._failed(request_id)
        Path(self.tmp.name, f"{request_id}.redispatch.json").write_text(
            "{",
            encoding="utf-8",
        )
        with self.assertRaises(CouncilReceiptCorrupt):
            self.store.claim_failed_redispatch(request_id, self.request_hash)
        with self.assertRaises(CouncilReceiptCorrupt):
            self.store.promptless_metadata(request_id, self.request_hash)

    def test_parseable_tampering_and_legacy_failure_have_no_authority(self) -> None:
        tampered_id = "lrq_fixture_tampered_failed_0001"
        self._failed(tampered_id)
        tampered_path = Path(self.tmp.name, f"{tampered_id}.json")
        tampered = json.loads(tampered_path.read_text(encoding="utf-8"))
        tampered["messages"] = [{"role": "user", "content": "unsafe"}]
        tampered_path.write_text(json.dumps(tampered), encoding="utf-8")
        with self.assertRaises(CouncilReceiptCorrupt):
            self.store.claim_failed_redispatch(tampered_id, self.request_hash)

        legacy_id = "lrq_fixture_legacy_failed_0001"
        now = datetime.now(timezone.utc).isoformat()
        Path(self.tmp.name, f"{legacy_id}.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "requestId": legacy_id,
                    "requestHash": self.request_hash,
                    "state": "failed",
                    "failureCode": "council_no_final_answer",
                    "createdAt": now,
                    "updatedAt": now,
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaises(CouncilReceiptCorrupt):
            self.store.claim_failed_redispatch(legacy_id, self.request_hash)

    def test_dispatch_authority_is_internal_versioned_and_mode_bound(self) -> None:
        request_id = "lrq_fixture_internal_evidence_0001"
        receipt = self.store.reserve(
            request_id,
            self.request_hash,
            dispatch_mode="direct_council",
        )
        self.assertEqual(receipt["dispatchEvidenceVersion"], 1)
        self.assertEqual(receipt["dispatchMode"], "direct_council")
        metadata = self.store.promptless_metadata(
            request_id,
            self.request_hash,
            receipt,
        )
        self.assertNotIn("dispatchEvidenceVersion", metadata)
        self.assertNotIn("dispatchMode", metadata)

    def test_redispatch_requires_one_exact_new_direct_failure_proof(self) -> None:
        def remove_new_authority(receipt: dict[str, object]) -> None:
            receipt.pop("dispatchEvidenceVersion")
            receipt.pop("dispatchMode")

        def wrong_mode(receipt: dict[str, object]) -> None:
            receipt["dispatchMode"] = "lite_council"

        def two_calls(receipt: dict[str, object]) -> None:
            usage = receipt["attempts"][0]["usage"]
            usage["callCount"] = 2
            receipt["attempts"][0]["usageEstimated"] = True

        def two_routes(receipt: dict[str, object]) -> None:
            route = receipt["attempts"][0]["modelRouting"][0]
            receipt["attempts"][0]["modelRouting"].append(copy.deepcopy(route))

        def succeeded_route(receipt: dict[str, object]) -> None:
            receipt["attempts"][0]["modelRouting"][0]["outcome"] = "succeeded"

        def fallback_route(receipt: dict[str, object]) -> None:
            receipt["attempts"][0]["modelRouting"][0]["fallback"] = True

        def mismatched_run(receipt: dict[str, object]) -> None:
            receipt["attempts"][0]["modelRouting"][0]["requestId"] = "crun_other"

        def missing_provider(receipt: dict[str, object]) -> None:
            receipt["attempts"][0]["modelRouting"][0]["provider"] = ""

        mutations = (
            remove_new_authority,
            wrong_mode,
            two_calls,
            two_routes,
            succeeded_route,
            fallback_route,
            mismatched_run,
            missing_provider,
        )
        for index, mutate in enumerate(mutations, start=1):
            with self.subTest(mutation=mutate.__name__):
                request_id = f"lrq_fixture_exact_proof_{index:04d}"
                self._failed(request_id)
                receipt_path = Path(self.tmp.name, f"{request_id}.json")
                receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                mutate(receipt)
                receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
                contender = StrictCouncilReceiptStore(self.tmp.name)
                try:
                    metadata = contender.promptless_metadata(
                        request_id,
                        self.request_hash,
                    )
                except CouncilReceiptCorrupt:
                    metadata = {"redispatchAllowed": False}
                self.assertFalse(metadata["redispatchAllowed"])
                with self.assertRaises((CouncilReceiptConflict, CouncilReceiptCorrupt)):
                    contender.claim_failed_redispatch(
                        request_id,
                        self.request_hash,
                    )
                self.assertFalse(
                    Path(self.tmp.name, f"{request_id}.redispatch.json").exists()
                )

    def test_failure_accounting_cannot_assert_absence_over_an_answer_or_wrong_mode(self) -> None:
        for index, mutation in enumerate(("answer", "mode"), start=1):
            with self.subTest(mutation=mutation):
                request_id = f"lrq_fixture_false_absence_{index:04d}"
                self.store.reserve(
                    request_id,
                    self.request_hash,
                    dispatch_mode="direct_council",
                )
                accounting = receipt_accounting(f"crun_false_absence_{index}")
                if mutation == "answer":
                    accounting["finalAnswer"] = "usable answer"
                    accounting["responseHash"] = hashlib.sha256(
                        b"usable answer"
                    ).hexdigest()
                else:
                    accounting["councilMode"] = "lite_council"
                with self.assertRaises(CouncilReceiptConflict):
                    self.store.fail_no_final_answer(
                        request_id,
                        self.request_hash,
                        accounting,
                    )
                self.assertEqual(
                    self.store.read(request_id, self.request_hash)["state"],
                    "started",
                )

    def test_one_unreported_direct_call_has_exact_redispatch_authority(self) -> None:
        request_id = "lrq_fixture_unreported_failure_0001"
        self.store.reserve(
            request_id,
            self.request_hash,
            dispatch_mode="direct_council",
        )
        accounting = receipt_accounting("crun_unreported_failure")
        accounting["usage"]["reportedCallCount"] = 0
        accounting["usageEstimated"] = True
        failed = self.store.fail_no_final_answer(
            request_id,
            self.request_hash,
            accounting,
        )
        self.assertTrue(
            self.store.promptless_metadata(
                request_id,
                self.request_hash,
                failed,
            )["redispatchAllowed"]
        )
        advanced = self.store.claim_failed_redispatch(
            request_id,
            self.request_hash,
        )
        self.assertEqual(advanced["dispatchCount"], 2)

    def test_completed_result_is_exactly_bound_to_last_attempt(self) -> None:
        def different_run(result: dict[str, object]) -> None:
            result["councilRunId"] = "crun_other_valid"
            result["modelRouting"][0]["requestId"] = "crun_other_valid"

        def different_answer(result: dict[str, object]) -> None:
            result["finalAnswer"] = '{"other":true}'
            result["responseHash"] = hashlib.sha256(
                result["finalAnswer"].encode("utf-8")
            ).hexdigest()

        def different_usage(result: dict[str, object]) -> None:
            result["usage"]["totalTokens"] += 1

        def different_usage_provenance(result: dict[str, object]) -> None:
            result["usage"]["reportedCallCount"] = 0
            result["usageEstimated"] = True

        def different_route(result: dict[str, object]) -> None:
            result["modelRouting"][0]["provider"] = "other-provider"

        def different_requested_model(result: dict[str, object]) -> None:
            result["requestedModel"] = "gpt-other"
            result["modelRouting"][0]["requestedModel"] = "gpt-other"

        def different_resolved_model(result: dict[str, object]) -> None:
            result["resolvedModel"] = "gpt-other"
            result["modelRouting"][0]["resolvedModel"] = "gpt-other"

        def different_times(result: dict[str, object]) -> None:
            result["updatedAt"] = "2030-01-01T00:00:02Z"

        mutations = (
            different_run,
            different_answer,
            different_usage,
            different_usage_provenance,
            different_route,
            different_requested_model,
            different_resolved_model,
            different_times,
        )
        for index, mutate in enumerate(mutations, start=1):
            with self.subTest(mutation=mutate.__name__):
                request_id = f"lrq_fixture_result_binding_{index:04d}"
                self.store.reserve(
                    request_id,
                    self.request_hash,
                    dispatch_mode="direct_council",
                )
                answer = '{"ok":true}'
                self.store.complete(
                    request_id,
                    self.request_hash,
                    {
                        **receipt_accounting(
                            f"crun_binding_{index}",
                            answer=answer,
                        ),
                        "finalAnswer": answer,
                    },
                )
                receipt_path = Path(self.tmp.name, f"{request_id}.json")
                receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                mutate(receipt["result"])
                receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
                with self.assertRaises(CouncilReceiptCorrupt):
                    self.store.read(request_id, self.request_hash)

    def test_completed_sanitizer_rejects_unsafe_numbers_types_and_times(self) -> None:
        def total_underflow(result: dict[str, object]) -> None:
            result["usage"]["totalTokens"] = 14

        def cached_over_input(result: dict[str, object]) -> None:
            result["usage"]["cachedInputTokens"] = 11

        def reasoning_over_output(result: dict[str, object]) -> None:
            result["usage"]["reasoningTokens"] = 6

        def unsafe_integer(result: dict[str, object]) -> None:
            result["usage"]["callCount"] = 9_007_199_254_740_992

        def reported_over_calls(result: dict[str, object]) -> None:
            result["usage"]["reportedCallCount"] = 2

        def false_provenance(result: dict[str, object]) -> None:
            result["usageEstimated"] = True

        def reversed_times(result: dict[str, object]) -> None:
            result["updatedAt"] = "2029-12-31T23:59:59Z"

        def malformed_route(result: dict[str, object]) -> None:
            result["modelRouting"][0]["schemaVersion"] = True

        def unsafe_extra(result: dict[str, object]) -> None:
            result["messages"] = [{"role": "user", "content": "SECRET"}]

        mutations = (
            total_underflow,
            cached_over_input,
            reasoning_over_output,
            unsafe_integer,
            reported_over_calls,
            false_provenance,
            reversed_times,
            malformed_route,
            unsafe_extra,
        )
        for index, mutate in enumerate(mutations, start=1):
            with self.subTest(mutation=mutate.__name__):
                request_id = f"lrq_fixture_result_guard_{index:04d}"
                self.store.reserve(
                    request_id,
                    self.request_hash,
                    dispatch_mode="direct_council",
                )
                answer = '{"ok":true}'
                result = {
                    **receipt_accounting(
                        f"crun_guard_{index}",
                        answer=answer,
                    ),
                    "finalAnswer": answer,
                }
                mutate(result)
                with self.assertRaises(CouncilReceiptConflict):
                    self.store.complete(request_id, self.request_hash, result)
                self.assertEqual(
                    self.store.read(request_id, self.request_hash)["state"],
                    "started",
                )


class RecoverableCouncilRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.receipts = Path(self.tmp.name, "receipts")
        self.ledger = Path(self.tmp.name, "ledger")
        self.env = patch.dict(
            os.environ,
            {
                "COUNCIL_REQUEST_RECEIPT_DIR": str(self.receipts),
                "COUNCIL_LEDGER_DIR": str(self.ledger),
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.router = OneCallRouter()
        runtime = CouncilRuntime(
            config=CouncilConfig(
                council_models=["gpt-fixture"],
                chairman_model="gpt-fixture",
                ledger_dir=str(self.ledger),
            ),
            router=self.router,
            ledger=JsonlCouncilLedger(self.ledger),
        )
        ask.set_council_runtime(runtime)
        self.addCleanup(lambda: ask.set_council_runtime(None))
        self.client = create_app().test_client()

    def payload(self, request_id: str) -> dict[str, object]:
        council_input = fixture_input()
        request_hash = council_request_hash_v1(
            council_input,
            effective_mode="direct_council",
        )
        return {
            "model": "gpt-fixture",
            "reasoning": {"effort": "max", "summary": "detailed"},
            "messages": council_input.messages,
            "taskType": "source_map",
            "gardenId": "fixture-garden",
            "sourceContext": {"stage": "fixture"},
            "councilModeOverride": "direct_council",
            "clientRequestId": request_id,
            "clientRequestHash": request_hash,
        }

    def responses_payload(self, request_id: str) -> dict[str, object]:
        council_input = fixture_input()
        request_hash = council_request_hash_v1(
            council_input,
            effective_mode="direct_council",
        )
        return {
            "model": "gpt-fixture",
            "reasoning": {"effort": "max", "summary": "detailed"},
            "instructions": "Receipt test system",
            "input": "Receipt test user",
            "taskType": "source_map",
            "gardenId": "fixture-garden",
            "sourceContext": {"stage": "fixture"},
            "councilModeOverride": "direct_council",
            "clientRequestId": request_id,
            "clientRequestHash": request_hash,
        }

    def use_router(self, router) -> None:
        runtime = CouncilRuntime(
            config=CouncilConfig(
                council_models=["gpt-fixture"],
                chairman_model="gpt-fixture",
                ledger_dir=str(self.ledger),
            ),
            router=router,
            ledger=JsonlCouncilLedger(self.ledger),
        )
        ask.set_council_runtime(runtime)

    def test_completed_result_resolves_without_second_provider_call(self) -> None:
        payload = self.payload("lrq_fixture_route_0001")
        response = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.router.calls, 1)

        resolved = self.client.get(
            "/v1/internal/council-results/resolve",
            query_string={
                "requestId": payload["clientRequestId"],
                "requestHash": payload["clientRequestHash"],
            },
        )
        self.assertEqual(resolved.status_code, 200, resolved.get_json())
        result = resolved.get_json()["result"]
        self.assertEqual(result["finalAnswer"], '{"fixture":true}')
        self.assertEqual(result["requestedModel"], "gpt-fixture")
        self.assertEqual(result["resolvedModel"], "gpt-fixture")
        self.assertEqual(result["usage"]["callCount"], 1)
        self.assertEqual(result["usage"]["reportedCallCount"], 1)
        self.assertEqual(len(result["modelRouting"]), 1)
        self.assertEqual(result["modelRouting"][0]["provider"], "chatgpt")
        self.assertFalse(result["modelRouting"][0]["fallback"])
        self.assertNotIn("messages", result)
        self.assertNotIn("sourceContext", result)
        self.assertNotIn("reasoningSummary", result)

    def test_backward_completed_result_drops_reasoning_and_rejects_prompt_fields(self) -> None:
        answer = '{"legacyReceipt":true}'
        for index, unsafe in enumerate((False, True), start=1):
            with self.subTest(unsafe=unsafe):
                request_id = f"lrq_fixture_old_completed_{index:04d}"
                request_hash = "d" * 64
                result = {
                    **receipt_accounting(
                        f"crun_old_completed_{index}",
                        answer=answer,
                    ),
                    "finalAnswer": answer,
                    "reasoningSummary": "PRIVATE-REASONING-MUST-NOT-LEAK",
                }
                if unsafe:
                    result["messages"] = [
                        {"role": "user", "content": "PROMPT-MUST-NOT-LEAK"}
                    ]
                now = datetime.now(timezone.utc).isoformat()
                self.receipts.mkdir(parents=True, exist_ok=True)
                (self.receipts / f"{request_id}.json").write_text(
                    json.dumps(
                        {
                            "schemaVersion": 1,
                            "requestId": request_id,
                            "requestHash": request_hash,
                            "state": "completed",
                            "createdAt": now,
                            "updatedAt": now,
                            "result": result,
                        }
                    ),
                    encoding="utf-8",
                )
                response = self.client.get(
                    "/v1/internal/council-results/resolve",
                    query_string={
                        "requestId": request_id,
                        "requestHash": request_hash,
                    },
                )
                serialized = json.dumps(response.get_json())
                self.assertNotIn("PRIVATE-REASONING-MUST-NOT-LEAK", serialized)
                self.assertNotIn("PROMPT-MUST-NOT-LEAK", serialized)
                if unsafe:
                    self.assertEqual(response.status_code, 409, response.get_json())
                    self.assertEqual(
                        response.get_json()["error"]["code"],
                        "receipt_corrupt",
                    )
                else:
                    self.assertEqual(response.status_code, 200, response.get_json())
                    self.assertNotIn("reasoningSummary", response.get_json()["result"])

    def test_failed_receipt_allows_one_explicit_redispatch_then_completes(self) -> None:
        router = SequencedStrictRouter(["fail", '{"recovered":true}'])
        self.use_router(router)
        payload = self.payload("lrq_fixture_failed_retry_0001")

        failed = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(failed.status_code, 502, failed.get_json())
        self.assertEqual(router.calls, 1)
        query = {
            "requestId": payload["clientRequestId"],
            "requestHash": payload["clientRequestHash"],
        }
        failed_lookup = self.client.get(
            "/v1/internal/council-results/resolve",
            query_string=query,
        )
        self.assertEqual(failed_lookup.status_code, 409, failed_lookup.get_json())
        body = failed_lookup.get_json()
        self.assertEqual(body["state"], "failed")
        self.assertEqual(body["error"]["code"], "request_failed")
        self.assertEqual(body["receipt"]["dispatchGeneration"], 1)
        self.assertEqual(body["receipt"]["dispatchCount"], 1)
        self.assertEqual(body["receipt"]["redispatchCount"], 0)
        self.assertTrue(body["receipt"]["redispatchAllowed"])
        self.assertEqual(
            body["receipt"]["failureCode"],
            "council_no_final_answer",
        )
        self.assertEqual(
            body["receipt"]["attempts"][0]["outcome"],
            "failed_no_final_answer",
        )
        serialized = json.dumps(body)
        self.assertNotIn("dispatchEvidenceVersion", serialized)
        self.assertNotIn("dispatchMode", serialized)
        self.assertNotIn("Receipt test user", serialized)
        self.assertNotIn("fixture upstream unavailable", serialized)
        receipt_text = (
            self.receipts / f"{payload['clientRequestId']}.json"
        ).read_text(encoding="utf-8")
        self.assertNotIn("Receipt test user", receipt_text)
        self.assertNotIn("fixture upstream unavailable", receipt_text)

        retry = {**payload, "clientRequestRedispatch": True}
        completed = self.client.post("/v1/chat/completions", json=retry)
        self.assertEqual(completed.status_code, 200, completed.get_json())
        self.assertEqual(router.calls, 2)
        claim_text = (
            self.receipts / f"{payload['clientRequestId']}.redispatch.json"
        ).read_text(encoding="utf-8")
        self.assertNotIn("Receipt test user", claim_text)
        resolved = self.client.get(
            "/v1/internal/council-results/resolve",
            query_string=query,
        )
        self.assertEqual(resolved.status_code, 200, resolved.get_json())
        receipt = resolved.get_json()["receipt"]
        self.assertEqual(receipt["dispatchGeneration"], 2)
        self.assertEqual(receipt["dispatchCount"], 2)
        self.assertEqual(receipt["redispatchCount"], 1)
        self.assertFalse(receipt["redispatchAllowed"])
        self.assertEqual(
            [attempt["outcome"] for attempt in receipt["attempts"]],
            ["failed_no_final_answer", "completed"],
        )
        self.assertEqual(
            [attempt["usage"]["callCount"] for attempt in receipt["attempts"]],
            [1, 1],
        )

        duplicate = self.client.post("/v1/chat/completions", json=retry)
        self.assertEqual(duplicate.status_code, 409, duplicate.get_json())
        self.assertEqual(router.calls, 2)

    def test_second_failed_generation_is_terminal(self) -> None:
        router = SequencedStrictRouter(["fail", "fail"])
        self.use_router(router)
        payload = self.payload("lrq_fixture_failed_retry_0002")
        first = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(first.status_code, 502, first.get_json())
        retry = {**payload, "clientRequestRedispatch": True}
        second = self.client.post("/v1/chat/completions", json=retry)
        self.assertEqual(second.status_code, 502, second.get_json())
        self.assertEqual(router.calls, 2)

        lookup = self.client.get(
            "/v1/internal/council-results/resolve",
            query_string={
                "requestId": payload["clientRequestId"],
                "requestHash": payload["clientRequestHash"],
            },
        )
        self.assertEqual(lookup.status_code, 409, lookup.get_json())
        receipt = lookup.get_json()["receipt"]
        self.assertEqual(receipt["dispatchCount"], 2)
        self.assertEqual(receipt["redispatchCount"], 1)
        self.assertFalse(receipt["redispatchAllowed"])
        self.assertEqual(len(receipt["attempts"]), 2)

        third = self.client.post("/v1/chat/completions", json=retry)
        self.assertEqual(third.status_code, 409, third.get_json())
        self.assertEqual(router.calls, 2)

    def test_responses_entrypoint_honors_the_same_explicit_redispatch_fence(self) -> None:
        router = SequencedStrictRouter(["fail", '{"responses":true}'])
        self.use_router(router)
        payload = self.responses_payload("lrq_fixture_responses_retry_0001")
        failed = self.client.post("/v1/responses", json=payload)
        self.assertEqual(failed.status_code, 502, failed.get_json())
        retry = {**payload, "client_request_redispatch": True}
        completed = self.client.post("/v1/responses", json=retry)
        self.assertEqual(completed.status_code, 200, completed.get_json())
        self.assertEqual(router.calls, 2)

        duplicate = self.client.post("/v1/responses", json=retry)
        self.assertEqual(duplicate.status_code, 409, duplicate.get_json())
        self.assertEqual(router.calls, 2)

    def test_explicit_redispatch_refuses_started_completed_corrupt_and_hash_conflict(self) -> None:
        cases: list[tuple[str, str]] = []
        store = StrictCouncilReceiptStore(self.receipts)

        started = self.payload("lrq_fixture_route_retry_started_0001")
        store.reserve(str(started["clientRequestId"]), str(started["clientRequestHash"]))
        cases.append(("started", str(started["clientRequestId"])))

        completed = self.payload("lrq_fixture_route_retry_complete_0001")
        completed_id = str(completed["clientRequestId"])
        completed_hash = str(completed["clientRequestHash"])
        store.reserve(completed_id, completed_hash)
        answer = '{"already":true}'
        store.complete(
            completed_id,
            completed_hash,
            {
                **receipt_accounting(f"crun_{completed_id}", answer=answer),
                "finalAnswer": answer,
            },
        )
        cases.append(("completed", completed_id))

        corrupt = self.payload("lrq_fixture_route_retry_corrupt_0001")
        corrupt_id = str(corrupt["clientRequestId"])
        self.receipts.mkdir(parents=True, exist_ok=True)
        (self.receipts / f"{corrupt_id}.json").write_text("{", encoding="utf-8")
        cases.append(("corrupt", corrupt_id))

        for _label, request_id in cases:
            payload = self.payload(request_id)
            payload["clientRequestRedispatch"] = True
            response = self.client.post("/v1/chat/completions", json=payload)
            self.assertEqual(response.status_code, 409, response.get_json())
        self.assertEqual(self.router.calls, 0)

        conflict = self.payload("lrq_fixture_route_retry_hash_0001")
        store.reserve(str(conflict["clientRequestId"]), "b" * 64)
        conflict["clientRequestRedispatch"] = True
        response = self.client.post("/v1/chat/completions", json=conflict)
        self.assertEqual(response.status_code, 409, response.get_json())
        self.assertEqual(self.router.calls, 0)

    def test_external_model_receipt_preserves_exact_provider_and_nested_upstream(self) -> None:
        model = "cliproxy/vendor/gemini-fixture"
        council_input = fixture_input()
        council_input.requested_model_alias = model
        council_input.requested_model = model
        council_input.resolved_model = model
        request_hash = council_request_hash_v1(
            council_input,
            effective_mode="direct_council",
        )
        payload = self.payload("lrq_fixture_external_route_0001")
        payload.update(
            {
                "model": model,
                "clientRequestHash": request_hash,
                "learnStrictRoute": True,
            }
        )

        response = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.router.calls, 1)
        self.assertEqual(self.router.strict_calls, 1)

        resolved = self.client.get(
            "/v1/internal/council-results/resolve",
            query_string={
                "requestId": payload["clientRequestId"],
                "requestHash": payload["clientRequestHash"],
            },
        )
        self.assertEqual(resolved.status_code, 200, resolved.get_json())
        result = resolved.get_json()["result"]
        self.assertEqual(result["requestedModel"], model)
        self.assertEqual(result["resolvedModel"], model)
        self.assertEqual(result["usage"]["callCount"], 1)
        self.assertEqual(result["usage"]["reportedCallCount"], 1)
        self.assertEqual(len(result["modelRouting"]), 1)
        route = result["modelRouting"][0]
        self.assertEqual(route["provider"], "cliproxy")
        self.assertEqual(route["upstreamModel"], "vendor/gemini-fixture")
        self.assertEqual(route["resolvedModel"], model)
        self.assertFalse(route["fallback"])
        self.assertEqual(self.router.calls, 1)

        duplicate = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(self.router.calls, 1)

    def test_unbound_learn_request_uses_strict_direct_council_route(self) -> None:
        payload = self.payload("lrq_fixture_unbound_strict_0001")
        payload.pop("clientRequestId")
        payload.pop("clientRequestHash")
        payload.pop("councilModeOverride")
        payload["learnStrictRoute"] = True
        response = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["councilMode"], "direct_council")
        self.assertEqual(self.router.calls, 1)
        self.assertEqual(self.router.strict_calls, 1)

    def test_bound_provider_failure_cannot_call_an_alternate_model(self) -> None:
        class StrictFailureRouter:
            def __init__(self) -> None:
                self.strict_calls = 0
                self.alternate_calls = 0

            def call_model_strict(self, _call):
                self.strict_calls += 1
                raise ProviderError(
                    "fixture exact route unavailable",
                    phase="connect",
                    replay_safe=True,
                )

            def call_model(self, _call):
                self.alternate_calls += 1
                return "must never be accepted"

        strict_router = StrictFailureRouter()
        runtime = CouncilRuntime(
            config=CouncilConfig(
                council_models=["gpt-fixture-alternate"],
                chairman_model="gpt-fixture-alternate",
                upstream_fallback_model="gpt-fixture-alternate",
                ledger_dir=str(self.ledger),
            ),
            router=strict_router,
            ledger=JsonlCouncilLedger(self.ledger),
        )
        original_runtime = ask.get_council_runtime()
        ask.set_council_runtime(runtime)
        try:
            payload = self.payload("lrq_fixture_strict_failure_0001")
            response = self.client.post("/v1/chat/completions", json=payload)
        finally:
            ask.set_council_runtime(original_runtime)
        self.assertNotEqual(response.status_code, 200, response.get_json())
        self.assertEqual(strict_router.strict_calls, 1)
        self.assertEqual(strict_router.alternate_calls, 0)

    def test_responses_completed_result_never_dispatches_duplicate(self) -> None:
        payload = self.responses_payload("lrq_fixture_responses_0001")
        response = self.client.post("/v1/responses", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.router.calls, 1)

        duplicate = self.client.post("/v1/responses", json=payload)
        self.assertEqual(duplicate.status_code, 409, duplicate.get_json())
        self.assertEqual(self.router.calls, 1)

        resolved = self.client.get(
            "/v1/internal/council-results/resolve",
            query_string={
                "requestId": payload["clientRequestId"],
                "requestHash": payload["clientRequestHash"],
            },
        )
        self.assertEqual(resolved.status_code, 200, resolved.get_json())
        self.assertEqual(
            resolved.get_json()["result"]["finalAnswer"],
            '{"fixture":true}',
        )

    def test_conflicting_binding_aliases_never_dispatch_on_either_entrypoint(self) -> None:
        cases = (
            (
                "/v1/chat/completions",
                self.payload,
                "client_request_id",
                "lrq_fixture_alias_conflict_other",
            ),
            (
                "/v1/chat/completions",
                self.payload,
                "client_request_hash",
                "b" * 64,
            ),
            (
                "/v1/responses",
                self.responses_payload,
                "client_request_id",
                "lrq_fixture_alias_conflict_other",
            ),
            (
                "/v1/responses",
                self.responses_payload,
                "client_request_hash",
                "b" * 64,
            ),
        )
        for index, (endpoint, payload_factory, alias, conflicting_value) in enumerate(cases):
            with self.subTest(endpoint=endpoint, alias=alias):
                payload = payload_factory(f"lrq_fixture_alias_{index:04d}")
                payload[alias] = conflicting_value
                response = self.client.post(endpoint, json=payload)
                self.assertEqual(response.status_code, 400, response.get_json())
                self.assertIn("Conflicting", response.get_json()["error"]["message"])
                self.assertEqual(self.router.calls, 0)
                self.assertFalse(
                    (self.receipts / f"{payload['clientRequestId']}.json").exists()
                )

        for index, (endpoint, payload_factory) in enumerate(
            (
                ("/v1/chat/completions", self.payload),
                ("/v1/responses", self.responses_payload),
            ),
            start=10,
        ):
            with self.subTest(endpoint=endpoint, alias="redispatch"):
                payload = payload_factory(f"lrq_fixture_alias_{index:04d}")
                payload["clientRequestRedispatch"] = True
                payload["client_request_redispatch"] = False
                response = self.client.post(endpoint, json=payload)
                self.assertEqual(response.status_code, 400, response.get_json())
                self.assertIn("Conflicting", response.get_json()["error"]["message"])
                self.assertEqual(self.router.calls, 0)

        malformed = self.payload("lrq_fixture_alias_malformed_0001")
        malformed["clientRequestRedispatch"] = "true"
        response = self.client.post("/v1/chat/completions", json=malformed)
        self.assertEqual(response.status_code, 400, response.get_json())
        self.assertEqual(self.router.calls, 0)

    def test_external_responses_provider_cannot_receive_recoverable_binding(self) -> None:
        for conflicting_alias in (False, True):
            with self.subTest(conflicting_alias=conflicting_alias):
                payload = self.responses_payload(
                    f"lrq_fixture_external_{int(conflicting_alias):04d}"
                )
                payload["model"] = "fixture-external/model"
                if conflicting_alias:
                    payload["client_request_id"] = "lrq_fixture_external_conflict"
                external_calls = 0

                def fake_external(*_args, **_kwargs):
                    nonlocal external_calls
                    external_calls += 1
                    raise AssertionError("external provider dispatch must be unreachable")

                with (
                    patch("chatmock.routes_openai.resolve_model") as resolved_model,
                    patch(
                        "chatmock.routes_openai.external_responses_response",
                        side_effect=fake_external,
                    ),
                ):
                    resolved_model.return_value.is_chatgpt = False
                    response = self.client.post("/v1/responses", json=payload)
                self.assertEqual(response.status_code, 400 if conflicting_alias else 409)
                self.assertEqual(external_calls, 0)
                self.assertEqual(self.router.calls, 0)

    def test_unsupported_http_transports_reject_bindings_before_dispatch(self) -> None:
        cases = (
            (
                "/v1/completions",
                {
                    "model": "gpt-fixture",
                    "prompt": "fixture",
                    "clientRequestId": "lrq_fixture_completion_chat_0001",
                    "clientRequestHash": "a" * 64,
                },
                409,
            ),
            (
                "/v1/completions",
                {
                    "model": "fixture-external/model",
                    "prompt": "fixture",
                    "client_request_id": "lrq_fixture_completion_external_0001",
                    "client_request_hash": "a" * 64,
                },
                409,
            ),
            (
                "/v1/completions",
                {
                    "model": "gpt-fixture",
                    "prompt": "fixture",
                    "clientRequestId": "lrq_fixture_completion_conflict_0001",
                    "client_request_id": "lrq_fixture_completion_conflict_other",
                    "clientRequestHash": "a" * 64,
                },
                400,
            ),
            (
                "/api/chat",
                {
                    "model": "gpt-fixture",
                    "messages": [{"role": "user", "content": "fixture"}],
                    "stream": False,
                    "client_request_id": "lrq_fixture_ollama_0001",
                    "client_request_hash": "a" * 64,
                },
                409,
            ),
            (
                "/api/chat",
                {
                    "model": "gpt-fixture",
                    "messages": [{"role": "user", "content": "fixture"}],
                    "stream": False,
                    "clientRequestId": "lrq_fixture_ollama_conflict_0001",
                    "client_request_id": "lrq_fixture_ollama_conflict_other",
                    "clientRequestHash": "a" * 64,
                },
                400,
            ),
            (
                "/v1/embeddings",
                {
                    "model": "local/all-MiniLM-L6-v2",
                    "input": "fixture",
                    "clientRequestId": "lrq_fixture_embedding_local_0001",
                    "clientRequestHash": "a" * 64,
                },
                409,
            ),
            (
                "/v1/embeddings",
                {
                    "model": "openai/text-embedding-3-small",
                    "input": "fixture",
                    "client_request_id": "lrq_fixture_embedding_remote_0001",
                    "client_request_hash": "a" * 64,
                },
                409,
            ),
            (
                "/v1/embeddings",
                {
                    "model": "local/all-MiniLM-L6-v2",
                    "input": "fixture",
                    "clientRequestId": "lrq_fixture_embedding_partial_0001",
                },
                400,
            ),
            (
                "/v1/embeddings",
                {
                    "model": "openai/text-embedding-3-small",
                    "input": "fixture",
                    "clientRequestId": "lrq_fixture_embedding_conflict_0001",
                    "client_request_id": "lrq_fixture_embedding_conflict_other",
                    "clientRequestHash": "a" * 64,
                },
                400,
            ),
        )
        with (
            patch("chatmock.routes_openai.start_upstream_request") as openai_start,
            patch(
                "chatmock.routes_openai.provider_dispatch.chat_completion_response"
            ) as external_dispatch,
            patch("chatmock.routes_ollama.start_upstream_request") as ollama_start,
            patch("chatmock.routes_embeddings.embed_local") as embedding_local,
            patch("chatmock.routes_embeddings.embed_remote") as embedding_remote,
        ):
            for endpoint, payload, expected_status in cases:
                with self.subTest(endpoint=endpoint, status=expected_status):
                    response = self.client.post(endpoint, json=payload)
                    self.assertEqual(
                        response.status_code,
                        expected_status,
                        response.get_json(),
                    )
        openai_start.assert_not_called()
        external_dispatch.assert_not_called()
        ollama_start.assert_not_called()
        embedding_local.assert_not_called()
        embedding_remote.assert_not_called()
        self.assertEqual(self.router.calls, 0)

    def test_unsupported_http_transports_reject_learn_strict_before_dispatch(self) -> None:
        cases = (
            (
                "/v1/completions",
                {"model": "gpt-fixture", "prompt": "fixture", "learnStrictRoute": True},
                409,
            ),
            (
                "/v1/completions",
                {"model": "fixture-external/model", "prompt": "fixture", "learn_strict_route": False},
                409,
            ),
            (
                "/v1/responses",
                {"model": "fixture-external/model", "input": "fixture", "learnStrictRoute": True},
                409,
            ),
            (
                "/api/chat",
                {
                    "model": "gpt-fixture",
                    "messages": [{"role": "user", "content": "fixture"}],
                    "stream": False,
                    "learn_strict_route": True,
                },
                409,
            ),
            (
                "/v1/embeddings",
                {
                    "model": "local/all-MiniLM-L6-v2",
                    "input": "fixture",
                    "learnStrictRoute": True,
                },
                409,
            ),
            (
                "/v1/embeddings",
                {
                    "model": "openai/text-embedding-3-small",
                    "input": "fixture",
                    "learnStrictRoute": True,
                    "learn_strict_route": False,
                },
                400,
            ),
        )
        with (
            patch("chatmock.routes_openai.start_upstream_request") as openai_start,
            patch(
                "chatmock.routes_openai.provider_dispatch.chat_completion_response"
            ) as external_dispatch,
            patch(
                "chatmock.routes_openai.external_responses_response"
            ) as external_responses,
            patch("chatmock.routes_ollama.start_upstream_request") as ollama_start,
            patch("chatmock.routes_embeddings.embed_local") as embedding_local,
            patch("chatmock.routes_embeddings.embed_remote") as embedding_remote,
        ):
            for endpoint, payload, expected_status in cases:
                with self.subTest(endpoint=endpoint, status=expected_status):
                    response = self.client.post(endpoint, json=payload)
                    self.assertEqual(
                        response.status_code,
                        expected_status,
                        response.get_json(),
                    )
        openai_start.assert_not_called()
        external_dispatch.assert_not_called()
        external_responses.assert_not_called()
        ollama_start.assert_not_called()
        embedding_local.assert_not_called()
        embedding_remote.assert_not_called()
        self.assertEqual(self.router.calls, 0)

    def test_hash_conflict_and_started_receipt_make_zero_provider_calls(self) -> None:
        mismatched = self.payload("lrq_fixture_route_0002")
        mismatched["clientRequestHash"] = "b" * 64
        response = self.client.post("/v1/chat/completions", json=mismatched)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.router.calls, 0)

        payload = self.payload("lrq_fixture_route_0003")
        StrictCouncilReceiptStore(self.receipts).reserve(
            str(payload["clientRequestId"]),
            str(payload["clientRequestHash"]),
        )
        response = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.router.calls, 0)

    def test_receipt_persistence_failure_prevents_dispatch(self) -> None:
        payload = self.payload("lrq_fixture_route_0004")
        with patch(
            "chatmock.council.gateway.default_receipt_store",
            side_effect=OSError("fixture persistence failure"),
        ):
            response = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.router.calls, 0)

    def test_council_bypass_cannot_dispatch_a_recoverable_request(self) -> None:
        payload = self.payload("lrq_fixture_route_0006")
        with patch(
            "chatmock.council.gateway.council_bypass_reason",
            return_value="fixture bypass",
        ):
            response = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.router.calls, 0)
        self.assertFalse(
            (self.receipts / f"{payload['clientRequestId']}.json").exists()
        )

    def test_completion_persistence_failure_stays_fenced_after_one_provider_call(self) -> None:
        payload = self.payload("lrq_fixture_route_0007")
        store = default_receipt_store()
        with patch.object(store, "complete", side_effect=OSError("fixture completion failure")):
            response = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.router.calls, 1)

        duplicate = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(self.router.calls, 1)
        resolved = self.client.get(
            "/v1/internal/council-results/resolve",
            query_string={
                "requestId": payload["clientRequestId"],
                "requestHash": payload["clientRequestHash"],
            },
        )
        self.assertEqual(resolved.status_code, 409)
        self.assertIn(
            resolved.get_json()["error"]["code"],
            {"request_started", "receipt_corrupt"},
        )

    def test_resolve_is_loopback_only_and_torn_receipt_fails_closed(self) -> None:
        payload = self.payload("lrq_fixture_route_0005")
        StrictCouncilReceiptStore(self.receipts).reserve(
            str(payload["clientRequestId"]),
            str(payload["clientRequestHash"]),
        )
        query = {
            "requestId": payload["clientRequestId"],
            "requestHash": payload["clientRequestHash"],
        }
        forbidden = self.client.get(
            "/v1/internal/council-results/resolve",
            query_string=query,
            environ_base={"REMOTE_ADDR": "203.0.113.4"},
        )
        self.assertEqual(forbidden.status_code, 403)
        receipt_path = self.receipts / f"{payload['clientRequestId']}.json"
        receipt_path.write_text("{", encoding="utf-8")
        ambiguous = self.client.get(
            "/v1/internal/council-results/resolve",
            query_string=query,
        )
        self.assertEqual(ambiguous.status_code, 409)
        self.assertEqual(ambiguous.get_json()["error"]["code"], "receipt_corrupt")


class LegacyCouncilOutcomeRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.now = datetime.now(timezone.utc)
        self.after = self.now - timedelta(minutes=5)
        self.before = self.now + timedelta(minutes=5)
        self.env = patch.dict(
            os.environ,
            {"COUNCIL_LEDGER_DIR": str(self.base)},
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = create_app().test_client()

    def failed_run(self, *, run_id: str = "crun_a1e3_fixture") -> dict[str, object]:
        return {
            "id": run_id,
            "messages": [
                {"role": "system", "content": "PROMPT-MUST-NOT-LEAK"},
                {"role": "user", "content": "SOURCE-MUST-NOT-LEAK"},
            ],
            "taskType": "subsection_generation",
            "gardenId": "fixture-garden",
            "pageId": "lesson-1-2",
            "sourceContext": {"private": "CONTEXT-MUST-NOT-LEAK"},
            "councilMode": "direct_council",
            "requestedModel": "gpt-5.6-sol",
            "resolvedModel": "gpt-5.6-sol",
            "modelRouting": [
                {
                    "schemaVersion": 1,
                    "at": self.now.isoformat(),
                    "requestId": run_id,
                    "endpoint": "council",
                    "requestedModel": "gpt-5.6-sol",
                    "resolvedModel": "gpt-5.6-sol",
                    "upstreamModel": "gpt-5.6-sol",
                    "provider": "chatgpt",
                    "outcome": "failed",
                    "fallback": False,
                    "statusCode": 502,
                    "error": "RAW-PROVIDER-ERROR-MUST-NOT-LEAK",
                    "errorCode": "connection_closed",
                    "failurePhase": "receive",
                    "partialOutput": True,
                    "replaySafe": False,
                }
            ],
            "candidates": [],
            "finalAnswer": None,
            "diagnostics": {"error": "DIAGNOSTIC-ERROR-MUST-NOT-LEAK"},
            "usage": {
                "inputTokens": 17,
                "outputTokens": 0,
                "totalTokens": 17,
                "cachedInputTokens": 0,
                "reasoningTokens": 0,
                "callCount": 1,
                "reportedCallCount": 1,
            },
            "createdAt": self.now.isoformat(),
            "updatedAt": (self.now + timedelta(seconds=1)).isoformat(),
        }

    def completed_run(
        self,
        *,
        run_id: str,
        answer: str = '{"completed":true}',
    ) -> dict[str, object]:
        run = self.failed_run(run_id=run_id)
        run.update(
            {
                "finalAnswer": answer,
                "diagnostics": None,
                "candidates": [{"id": "candidate-ledger-only"}],
                "modelRouting": [
                    {
                        "schemaVersion": 1,
                        "at": self.now.isoformat(),
                        "requestId": run_id,
                        "endpoint": "council",
                        "requestedModel": "gpt-5.6-sol",
                        "resolvedModel": "gpt-5.6-sol",
                        "upstreamModel": "gpt-5.6-sol",
                        "provider": "chatgpt",
                        "outcome": "succeeded",
                        "fallback": False,
                        "statusCode": 200,
                    }
                ],
                "reasoningSummary": "PRIVATE-REASONING-MUST-NOT-LEAK",
            }
        )
        return run

    @staticmethod
    def request_hash(run: dict[str, object]) -> str:
        return legacy_run_hash_v1(
            run,
            reasoning_effort="max",
            reasoning_summary="detailed",
        )

    def query(self, run: dict[str, object]) -> dict[str, str]:
        return {
            "requestHash": self.request_hash(run),
            "createdAfter": self.after.isoformat(),
            "createdBefore": self.before.isoformat(),
            "reasoningEffort": "max",
            "reasoningSummary": "detailed",
        }

    def write_run(self, run: dict[str, object]) -> None:
        path = self.base / f"{run['id']}.json"
        path.write_text(json.dumps(run), encoding="utf-8")

    def test_null_final_answer_resolves_one_sanitized_failed_proof(self) -> None:
        run = self.failed_run()
        self.write_run(run)
        response = self.client.get(
            "/v1/internal/council-results/legacy-outcome",
            query_string=self.query(run),
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        body = response.get_json()
        self.assertEqual(body["state"], "failed")
        self.assertTrue(body["legacy"])
        failure = body["failure"]
        self.assertEqual(failure["outcome"], "failed")
        self.assertEqual(failure["councilRunId"], run["id"])
        self.assertIs(failure["finalAnswerPresent"], False)
        self.assertEqual(failure["candidateCount"], 0)
        self.assertEqual(failure["failureCode"], "connection_closed")
        self.assertEqual(failure["failurePhase"], "receive")
        self.assertIs(failure["partialOutput"], True)
        self.assertIs(failure["replaySafe"], False)
        self.assertEqual(failure["usage"]["callCount"], 1)
        self.assertNotIn("error", failure["modelRouting"][0])
        serialized = json.dumps(body)
        for secret in (
            "PROMPT-MUST-NOT-LEAK",
            "SOURCE-MUST-NOT-LEAK",
            "CONTEXT-MUST-NOT-LEAK",
            "RAW-PROVIDER-ERROR-MUST-NOT-LEAK",
            "DIAGNOSTIC-ERROR-MUST-NOT-LEAK",
        ):
            self.assertNotIn(secret, serialized)

    def test_blank_final_answer_is_also_exact_absence(self) -> None:
        run = self.failed_run(run_id="crun_blank_failure_fixture")
        run["finalAnswer"] = "   "
        self.write_run(run)
        response = self.client.get(
            "/v1/internal/council-results/legacy-outcome",
            query_string=self.query(run),
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["state"], "failed")

    def test_completed_outcome_preserves_existing_safe_result_contract(self) -> None:
        answer = '{"completed":true}'
        run = self.completed_run(
            run_id="crun_completed_outcome_fixture",
            answer=answer,
        )
        self.write_run(run)
        response = self.client.get(
            "/v1/internal/council-results/legacy-outcome",
            query_string=self.query(run),
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        body = response.get_json()
        self.assertEqual(body["state"], "completed")
        self.assertEqual(body["result"]["finalAnswer"], answer)
        self.assertEqual(
            body["result"]["responseHash"],
            hashlib.sha256(answer.encode("utf-8")).hexdigest(),
        )
        self.assertNotIn("candidates", body["result"])
        self.assertNotIn("reasoningSummary", body["result"])
        self.assertNotIn("PRIVATE-REASONING-MUST-NOT-LEAK", json.dumps(body))

    def test_unrelated_late_visualization_does_not_poison_exact_lesson(self) -> None:
        target = self.completed_run(run_id="crun_lesson_target_fixture")
        unrelated = self.completed_run(run_id="crun_visualization_unrelated_fixture")
        unrelated.update(
            {
                "messages": [{"role": "user", "content": "unrelated visual"}],
                "taskType": "visualization_generation",
                "pageId": "visualization-page",
                "sourceContext": {"stage": "visualization"},
            }
        )
        self.write_run(target)
        self.write_run(unrelated)
        unrelated_path = self.base / f"{unrelated['id']}.json"
        published_late = (self.before + timedelta(seconds=1)).timestamp()
        os.utime(unrelated_path, (published_late, published_late))

        for endpoint in (
            "/v1/internal/council-results/legacy-resolve",
            "/v1/internal/council-results/legacy-outcome",
        ):
            with self.subTest(endpoint=endpoint):
                response = self.client.get(endpoint, query_string=self.query(target))
                self.assertEqual(response.status_code, 200, response.get_json())
                self.assertEqual(response.get_json()["state"], "completed")
                self.assertEqual(
                    response.get_json()["result"]["councilRunId"],
                    target["id"],
                )

    def test_exact_late_publication_and_terminal_time_fail_both_resolvers(self) -> None:
        for case in ("publication", "terminal"):
            with self.subTest(case=case):
                for path in self.base.glob("crun_*.json"):
                    path.unlink()
                target = self.completed_run(run_id=f"crun_exact_{case}_fixture")
                if case == "terminal":
                    target["updatedAt"] = (
                        self.before + timedelta(seconds=1)
                    ).isoformat()
                self.write_run(target)
                if case == "publication":
                    target_path = self.base / f"{target['id']}.json"
                    published_late = (self.before + timedelta(seconds=1)).timestamp()
                    os.utime(target_path, (published_late, published_late))
                for endpoint in (
                    "/v1/internal/council-results/legacy-resolve",
                    "/v1/internal/council-results/legacy-outcome",
                ):
                    response = self.client.get(endpoint, query_string=self.query(target))
                    self.assertEqual(response.status_code, 409, response.get_json())
                    self.assertEqual(
                        response.get_json()["error"]["code"],
                        "legacy_ledger_ambiguous",
                    )

    def test_torn_and_duplicate_exact_completion_fail_both_resolvers(self) -> None:
        target = self.completed_run(run_id="crun_torn_query_fixture")
        (self.base / "crun_torn_in_fence.json").write_text("{", encoding="utf-8")
        for endpoint in (
            "/v1/internal/council-results/legacy-resolve",
            "/v1/internal/council-results/legacy-outcome",
        ):
            response = self.client.get(endpoint, query_string=self.query(target))
            self.assertEqual(response.status_code, 409, response.get_json())
            self.assertEqual(
                response.get_json()["error"]["code"],
                "legacy_ledger_ambiguous",
            )

        for path in self.base.glob("crun_*.json"):
            path.unlink()
        self.write_run(target)
        duplicate = copy.deepcopy(target)
        duplicate["id"] = "crun_duplicate_completion_fixture"
        duplicate["modelRouting"][0]["requestId"] = duplicate["id"]
        self.write_run(duplicate)
        for endpoint in (
            "/v1/internal/council-results/legacy-resolve",
            "/v1/internal/council-results/legacy-outcome",
        ):
            response = self.client.get(endpoint, query_string=self.query(target))
            self.assertEqual(response.status_code, 409, response.get_json())
            self.assertEqual(
                response.get_json()["error"]["code"],
                "legacy_multiple",
            )

    def test_malformed_exact_completed_and_failed_evidence_is_ambiguous(self) -> None:
        completed_mutations = (
            lambda run: run["usage"].update(totalTokens=1),
            lambda run: run["modelRouting"][0].update(schemaVersion=True),
            lambda run: run.update(updatedAt=(self.now - timedelta(seconds=1)).isoformat()),
        )
        for index, mutate in enumerate(completed_mutations, start=1):
            with self.subTest(kind="completed", index=index):
                for path in self.base.glob("crun_*.json"):
                    path.unlink()
                run = self.completed_run(run_id=f"crun_bad_completed_{index}")
                mutate(run)
                self.write_run(run)
                for endpoint in (
                    "/v1/internal/council-results/legacy-resolve",
                    "/v1/internal/council-results/legacy-outcome",
                ):
                    response = self.client.get(endpoint, query_string=self.query(run))
                    self.assertEqual(response.status_code, 409, response.get_json())

        def two_failed_routes(run: dict[str, object]) -> None:
            run["modelRouting"].append(copy.deepcopy(run["modelRouting"][0]))

        failed_mutations = (
            lambda run: run["usage"].update(callCount=2),
            two_failed_routes,
            lambda run: run["modelRouting"][0].update(outcome="succeeded"),
            lambda run: run["modelRouting"][0].update(fallback=True),
            lambda run: run["modelRouting"][0].update(provider=""),
            lambda run: run["modelRouting"][0].update(requestId="crun_other"),
        )
        for index, mutate in enumerate(failed_mutations, start=1):
            with self.subTest(kind="failed", index=index):
                for path in self.base.glob("crun_*.json"):
                    path.unlink()
                run = self.failed_run(run_id=f"crun_bad_failure_{index}")
                mutate(run)
                self.write_run(run)
                response = self.client.get(
                    "/v1/internal/council-results/legacy-outcome",
                    query_string=self.query(run),
                )
                self.assertEqual(response.status_code, 409, response.get_json())
                serialized = json.dumps(response.get_json())
                self.assertNotIn("PROMPT-MUST-NOT-LEAK", serialized)
                self.assertNotIn("DIAGNOSTIC-ERROR-MUST-NOT-LEAK", serialized)

    def test_zero_multiple_and_unsafe_failure_fail_closed(self) -> None:
        run = self.failed_run(run_id="crun_legacy_outcome_zero")
        query = self.query(run)
        missing = self.client.get(
            "/v1/internal/council-results/legacy-outcome",
            query_string=query,
        )
        self.assertEqual(missing.status_code, 404, missing.get_json())
        self.assertEqual(missing.get_json()["error"]["code"], "legacy_not_found")

        self.write_run(run)
        duplicate = {**run, "id": "crun_legacy_outcome_duplicate"}
        duplicate["modelRouting"] = [
            {
                **run["modelRouting"][0],
                "requestId": duplicate["id"],
            }
        ]
        self.write_run(duplicate)
        multiple = self.client.get(
            "/v1/internal/council-results/legacy-outcome",
            query_string=query,
        )
        self.assertEqual(multiple.status_code, 409, multiple.get_json())
        self.assertEqual(multiple.get_json()["error"]["code"], "legacy_multiple")

        for path in self.base.glob("crun_*.json"):
            path.unlink()
        unsafe = self.failed_run(run_id="crun_legacy_outcome_unsafe")
        unsafe["candidates"] = [{"content": "partial model answer"}]
        self.write_run(unsafe)
        ambiguous = self.client.get(
            "/v1/internal/council-results/legacy-outcome",
            query_string=self.query(unsafe),
        )
        self.assertEqual(ambiguous.status_code, 409, ambiguous.get_json())
        self.assertEqual(
            ambiguous.get_json()["error"]["code"],
            "legacy_ledger_ambiguous",
        )

    def test_outcome_rejects_broad_fence_and_browser_origin(self) -> None:
        run = self.failed_run(run_id="crun_legacy_outcome_guards")
        self.write_run(run)
        broad = self.query(run)
        broad["createdAfter"] = (self.now - timedelta(hours=49)).isoformat()
        response = self.client.get(
            "/v1/internal/council-results/legacy-outcome",
            query_string=broad,
        )
        self.assertEqual(response.status_code, 400, response.get_json())
        self.assertEqual(response.get_json()["error"]["code"], "invalid_fence")

        browser = self.client.get(
            "/v1/internal/council-results/legacy-outcome",
            query_string=self.query(run),
            headers={"Origin": "http://localhost:3000"},
        )
        self.assertEqual(browser.status_code, 403, browser.get_json())
        self.assertEqual(browser.get_json()["error"]["code"], "browser_forbidden")


class LegacyCouncilLookupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.after = datetime.now(timezone.utc) - timedelta(minutes=5)
        self.before = datetime.now(timezone.utc) + timedelta(minutes=5)
        run_created = datetime.now(timezone.utc)
        self.run = {
            "id": "crun_fixture_legacy",
            "messages": [{"role": "user", "content": "fixture"}],
            "taskType": "source_map",
            "gardenId": "fixture-garden",
            "pageId": None,
            "sourceContext": {"stage": "fixture"},
            "councilMode": "direct_council",
            "requestedModel": "gpt-fixture",
            "resolvedModel": "gpt-fixture",
            "modelRouting": [
                {
                    "schemaVersion": 1,
                    "at": run_created.isoformat(),
                    "requestId": "crun_fixture_legacy",
                    "endpoint": "council",
                    "requestedModel": "gpt-fixture",
                    "resolvedModel": "gpt-fixture",
                    "upstreamModel": "gpt-fixture",
                    "provider": "chatgpt",
                    "outcome": "succeeded",
                    "fallback": False,
                }
            ],
            "finalAnswer": '{"legacy":true}',
            "usage": {
                "inputTokens": 10,
                "outputTokens": 5,
                "totalTokens": 15,
                "cachedInputTokens": 0,
                "reasoningTokens": 0,
                "callCount": 1,
                "reportedCallCount": 1,
            },
            "createdAt": run_created.isoformat(),
            "updatedAt": (run_created + timedelta(seconds=1)).isoformat(),
        }

    def request_hash(self) -> str:
        envelope = {
            "schemaVersion": 1,
            "messages": self.run["messages"],
            "taskType": self.run["taskType"],
            "gardenId": self.run["gardenId"],
            "pageId": self.run["pageId"],
            "sourceContext": self.run["sourceContext"],
            "councilMode": self.run["councilMode"],
            "requestedModel": self.run["requestedModel"],
            "resolvedModel": self.run["resolvedModel"],
            "reasoning": {"effort": "max", "summary": "detailed"},
            "temperature": None,
            "maxTokens": None,
        }
        return hashlib.sha256(canonical_json_v1(envelope).encode("utf-8")).hexdigest()

    def matches(self):
        return legacy_completed_matches(
            request_hash=self.request_hash(),
            created_after=self.after,
            created_before=self.before,
            reasoning_effort="max",
            reasoning_summary="detailed",
            ledger_dir=self.base,
        )

    def test_zero_one_and_multiple_exact_matches(self) -> None:
        self.assertEqual(self.matches(), [])
        (self.base / "crun_fixture_legacy.json").write_text(
            json.dumps(self.run), encoding="utf-8"
        )
        self.assertEqual(len(self.matches()), 1)
        duplicate = {**self.run, "id": "crun_fixture_legacy_duplicate"}
        duplicate["modelRouting"] = [
            {
                **self.run["modelRouting"][0],
                "requestId": duplicate["id"],
            }
        ]
        (self.base / "crun_fixture_legacy_duplicate.json").write_text(
            json.dumps(duplicate), encoding="utf-8"
        )
        self.assertEqual(len(self.matches()), 2)

    def test_malformed_metadata_inside_time_fence_is_ambiguity(self) -> None:
        snapshot = self.base / "crun_fixture_bad.json"
        for payload in (
            "[]",
            json.dumps({"createdAt": "not-a-time"}),
            (
                '{\n  "broken": ,\n'
                f'  "createdAt": "{datetime.now(timezone.utc).isoformat()}",\n'
                f'  "updatedAt": "{datetime.now(timezone.utc).isoformat()}"\n}}'
            ),
        ):
            with self.subTest(payload=payload[:24]):
                snapshot.write_text(payload, encoding="utf-8")
                read_paths: list[Path] = []
                original_read_text = Path.read_text

                def tracked_read_text(path: Path, *args, **kwargs):
                    read_paths.append(path)
                    return original_read_text(path, *args, **kwargs)

                with (
                    patch.object(Path, "read_text", new=tracked_read_text),
                    self.assertRaises(CouncilReceiptCorrupt),
                ):
                    self.matches()
                self.assertEqual(read_paths, [snapshot])

    def test_canonical_snapshot_outside_fence_skips_full_parse(self) -> None:
        snapshot = self.base / "crun_fixture_outside.json"
        created = self.after - timedelta(days=1)
        outside = {
            **self.run,
            "createdAt": created.isoformat(),
            "updatedAt": (created + timedelta(seconds=20)).isoformat(),
        }
        snapshot.write_text(json.dumps(outside, indent=2), encoding="utf-8")
        os.utime(snapshot, (created.timestamp(), created.timestamp()))
        read_paths: list[Path] = []
        original_read_text = Path.read_text

        def tracked_read_text(path: Path, *args, **kwargs):
            read_paths.append(path)
            return original_read_text(path, *args, **kwargs)

        with patch.object(Path, "read_text", new=tracked_read_text):
            self.assertEqual(self.matches(), [])
        self.assertEqual(read_paths, [])

    def test_noncanonical_snapshot_outside_fence_preserves_full_parse(self) -> None:
        snapshot = self.base / "crun_fixture_outside.json"
        created = self.after - timedelta(days=1)
        outside = {
            **self.run,
            "createdAt": created.isoformat(),
            "updatedAt": (created + timedelta(seconds=20)).isoformat(),
        }
        snapshot.write_text(json.dumps(outside), encoding="utf-8")
        os.utime(snapshot, (created.timestamp(), created.timestamp()))
        read_paths: list[Path] = []
        original_read_text = Path.read_text

        def tracked_read_text(path: Path, *args, **kwargs):
            read_paths.append(path)
            return original_read_text(path, *args, **kwargs)

        with patch.object(Path, "read_text", new=tracked_read_text):
            self.assertEqual(self.matches(), [])
        self.assertEqual(read_paths, [snapshot])

    def test_canonical_snapshot_replaced_before_skip_uses_new_path(self) -> None:
        snapshot = self.base / "crun_fixture_replaced.json"
        replacement = self.base / "replacement.json"
        outside_created = self.after - timedelta(days=1)
        outside = {
            **self.run,
            "createdAt": outside_created.isoformat(),
            "updatedAt": (outside_created + timedelta(seconds=20)).isoformat(),
        }
        snapshot.write_text(json.dumps(outside, indent=2), encoding="utf-8")
        os.utime(
            snapshot,
            (outside_created.timestamp(), outside_created.timestamp()),
        )
        replacement.write_text(json.dumps(self.run, indent=2), encoding="utf-8")
        in_fence_mtime = datetime.now(timezone.utc).timestamp()
        os.utime(replacement, (in_fence_mtime, in_fence_mtime))

        original_parse_iso = request_receipts_module.parse_iso
        parse_calls = 0

        def replace_during_fast_tail_parse(value: str):
            nonlocal parse_calls
            parse_calls += 1
            if parse_calls == 1:
                os.replace(replacement, snapshot)
            return original_parse_iso(value)

        with patch.object(
            request_receipts_module,
            "parse_iso",
            new=replace_during_fast_tail_parse,
        ):
            matches = self.matches()
        self.assertGreaterEqual(parse_calls, 2)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["councilRunId"], self.run["id"])

    def test_backdated_snapshot_published_after_recovery_is_ambiguity(self) -> None:
        snapshot = self.base / "crun_fixture_legacy.json"
        snapshot.write_text(json.dumps(self.run, indent=2), encoding="utf-8")
        published_after_recovery = (self.before + timedelta(seconds=1)).timestamp()
        os.utime(snapshot, (published_after_recovery, published_after_recovery))
        read_paths: list[Path] = []
        original_read_text = Path.read_text

        def tracked_read_text(path: Path, *args, **kwargs):
            read_paths.append(path)
            return original_read_text(path, *args, **kwargs)

        with (
            patch.object(Path, "read_text", new=tracked_read_text),
            self.assertRaisesRegex(
                CouncilReceiptCorrupt,
                "publication is outside the recovery fence",
            ),
        ):
            self.matches()
        self.assertEqual(read_paths, [snapshot])

    def inventory_runs(self) -> tuple[dict[str, object], dict[str, object]]:
        first_created = datetime.now(timezone.utc) - timedelta(minutes=2)
        first_updated = first_created + timedelta(seconds=20)
        second_created = first_updated + timedelta(seconds=1)
        second_updated = second_created + timedelta(seconds=20)
        first = {
            **self.run,
            "sourceContext": {
                "gardenId": "fixture-garden",
                "sourceSetHash": "e" * 64,
                "sourceIds": ["source-a"],
                "taskType": "syllabus_reading",
            },
            "modelRouting": [
                {
                    **self.run["modelRouting"][0],
                    "at": first_created.isoformat(),
                }
            ],
            "createdAt": first_created.isoformat(),
            "updatedAt": first_updated.isoformat(),
        }
        second = {
            **self.run,
            "id": "crun_fixture_legacy_repair",
            "messages": [
                {"role": "system", "content": "repair"},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "repairAttempt": 1,
                            "invalidResponse": json.loads(first["finalAnswer"]),
                        },
                        separators=(",", ":"),
                    ),
                },
            ],
            "sourceContext": {
                "gardenId": "fixture-garden",
                "taskType": "source_map",
                "stageLabel": "Syllabus reading",
                "repairAttempt": 1,
            },
            "finalAnswer": '{"legacy":"repaired"}',
            "modelRouting": [
                {
                    **self.run["modelRouting"][0],
                    "at": second_created.isoformat(),
                    "requestId": "crun_fixture_legacy_repair",
                }
            ],
            "createdAt": second_created.isoformat(),
            "updatedAt": second_updated.isoformat(),
        }
        return first, second

    def test_inventory_is_ordered_selection_bound_and_promptless(self) -> None:
        first, second = self.inventory_runs()
        for run in (first, second):
            (self.base / f"{run['id']}.json").write_text(
                json.dumps(run), encoding="utf-8"
            )
        inventory = legacy_completed_inventory(
            created_after=self.after,
            created_before=self.before,
            reasoning_effort="max",
            reasoning_summary="detailed",
            garden_id="fixture-garden",
            requested_model="gpt-fixture",
            source_set_hash="e" * 64,
            source_ids=["source-a"],
            ledger_dir=self.base,
        )
        self.assertEqual([row["sequence"] for row in inventory], [0, 1])
        self.assertEqual(
            [row["councilRunId"] for row in inventory],
            ["crun_fixture_legacy", "crun_fixture_legacy_repair"],
        )
        for row in inventory:
            self.assertNotIn("messages", row)
            self.assertNotIn("sourceContext", row)
            self.assertNotIn("finalAnswer", row)
            self.assertEqual(len(row["requestHash"]), 64)

        with patch.dict(os.environ, {"COUNCIL_LEDGER_DIR": str(self.base)}):
            client = create_app().test_client()
            response = client.get(
                "/v1/internal/council-results/legacy-inventory",
                query_string={
                    "createdAfter": self.after.isoformat(),
                    "createdBefore": self.before.isoformat(),
                    "reasoningEffort": "max",
                    "reasoningSummary": "detailed",
                    "gardenId": "fixture-garden",
                    "requestedModel": "gpt-fixture",
                    "sourceSetHash": "e" * 64,
                    "sourceIdsJson": json.dumps(["source-a"]),
                },
            )
            node_fetch_compatible = client.get(
                "/v1/internal/council-results/legacy-inventory",
                query_string={
                    "createdAfter": self.after.isoformat(),
                    "createdBefore": self.before.isoformat(),
                    "reasoningEffort": "max",
                    "reasoningSummary": "detailed",
                    "gardenId": "fixture-garden",
                    "requestedModel": "gpt-fixture",
                    "sourceSetHash": "e" * 64,
                    "sourceIdsJson": json.dumps(["source-a"]),
                },
                headers={"Sec-Fetch-Mode": "cors"},
            )
            forbidden = client.get(
                "/v1/internal/council-results/legacy-inventory",
                query_string={
                    "createdAfter": self.after.isoformat(),
                    "createdBefore": self.before.isoformat(),
                    "reasoningEffort": "max",
                    "reasoningSummary": "detailed",
                    "gardenId": "fixture-garden",
                    "requestedModel": "gpt-fixture",
                    "sourceSetHash": "e" * 64,
                    "sourceIdsJson": json.dumps(["source-a"]),
                },
                environ_base={"REMOTE_ADDR": "203.0.113.4"},
            )
            browser = client.get(
                "/v1/internal/council-results/legacy-inventory",
                query_string={
                    "createdAfter": self.after.isoformat(),
                    "createdBefore": self.before.isoformat(),
                    "reasoningEffort": "max",
                    "reasoningSummary": "detailed",
                    "gardenId": "fixture-garden",
                    "requestedModel": "gpt-fixture",
                    "sourceSetHash": "e" * 64,
                    "sourceIdsJson": json.dumps(["source-a"]),
                },
                headers={"Origin": "https://attacker.example"},
            )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(
            node_fetch_compatible.status_code,
            200,
            node_fetch_compatible.get_json(),
        )
        self.assertEqual(len(response.get_json()["results"]), 2)
        for row in response.get_json()["results"]:
            self.assertTrue(
                {"messages", "sourceContext", "userPrompt", "finalAnswer"}.isdisjoint(row)
            )
        self.assertEqual(forbidden.status_code, 403)
        self.assertEqual(browser.status_code, 403)
        self.assertEqual(browser.get_json()["error"]["code"], "browser_forbidden")

    def test_inventory_rejects_unbound_or_duplicate_legacy_runs(self) -> None:
        first, second = self.inventory_runs()
        second["sourceContext"] = {"gardenId": "fixture-garden", "repairAttempt": 1}
        second["messages"] = [{"role": "user", "content": "{}"}]
        for run in (first, second):
            (self.base / f"{run['id']}.json").write_text(
                json.dumps(run), encoding="utf-8"
            )
        with self.assertRaises(CouncilReceiptCorrupt):
            legacy_completed_inventory(
                created_after=self.after,
                created_before=self.before,
                reasoning_effort="max",
                reasoning_summary="detailed",
                garden_id="fixture-garden",
                requested_model="gpt-fixture",
                source_set_hash="e" * 64,
                source_ids=["source-a"],
                ledger_dir=self.base,
            )
if __name__ == "__main__":
    unittest.main()
