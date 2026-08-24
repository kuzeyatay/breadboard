from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import call, patch

from chatmock import ask
from chatmock.app import create_app
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
                "councilRunId": "crun_fixture",
                "finalAnswer": '{"ok":true}',
                "responseHash": hashlib.sha256(b'{"ok":true}').hexdigest(),
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


class LegacyCouncilLookupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.after = datetime.now(timezone.utc) - timedelta(minutes=5)
        self.before = datetime.now(timezone.utc) + timedelta(minutes=5)
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
            "usage": {},
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
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
        (self.base / "crun_fixture_legacy_duplicate.json").write_text(
            json.dumps(duplicate), encoding="utf-8"
        )
        self.assertEqual(len(self.matches()), 2)

    def test_malformed_metadata_inside_time_fence_is_ambiguity(self) -> None:
        (self.base / "crun_fixture_bad.json").write_text("[]", encoding="utf-8")
        with self.assertRaises(CouncilReceiptCorrupt):
            self.matches()
        (self.base / "crun_fixture_bad.json").write_text(
            json.dumps({"createdAt": "not-a-time"}), encoding="utf-8"
        )
        with self.assertRaises(CouncilReceiptCorrupt):
            self.matches()

    def test_backdated_snapshot_published_after_recovery_is_ambiguity(self) -> None:
        snapshot = self.base / "crun_fixture_legacy.json"
        snapshot.write_text(json.dumps(self.run), encoding="utf-8")
        published_after_recovery = (self.before + timedelta(seconds=1)).timestamp()
        os.utime(snapshot, (published_after_recovery, published_after_recovery))
        with self.assertRaisesRegex(
            CouncilReceiptCorrupt,
            "publication is outside the recovery fence",
        ):
            self.matches()

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
            "usage": {"callCount": 1, "reportedCallCount": 1},
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
            "usage": {"callCount": 1, "reportedCallCount": 1},
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
