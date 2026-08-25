from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from chatmock import ask
from chatmock.app import create_app
from chatmock.council.gateway import council_bypass_reason
from chatmock.council.ledger import JsonlCouncilLedger
from chatmock.council.policy import CouncilConfig
from chatmock.council.request_receipts import council_request_hash_v1
from chatmock.council.runtime import CouncilRuntime
from chatmock.council.types import CouncilInput
from chatmock.providers.registry import resolve_model
from chatmock.providers.types import ModelTokenUsage


IMAGE_BYTES = b"generated-visual-preview"
IMAGE_BASE64 = "Z2VuZXJhdGVkLXZpc3VhbC1wcmV2aWV3"
IMAGE_URL = f"data:image/png;base64,{IMAGE_BASE64}"
IMAGE_PART = {
    "type": "image_url",
    "image_url": {"url": IMAGE_URL, "detail": "original"},
}
MULTIMODAL_MESSAGES = [
    {"role": "system", "content": "Inspect the supplied preview."},
    {
        "role": "user",
        "content": [
            {"type": "text", "text": "Return the reviewed visualization JSON."},
            IMAGE_PART,
        ],
    },
]


class RecordingRouter:
    def __init__(self) -> None:
        self.calls = []
        self.strict_calls = 0

    def effective_model(self, model: str) -> str:
        return model

    def _answer(self, call) -> str:
        self.calls.append(call)
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
        call.usage_out = ModelTokenUsage(12, 6, 18)
        return '{"visualization":true}'

    def call_model(self, call) -> str:
        return self._answer(call)

    def call_model_strict(self, call) -> str:
        self.strict_calls += 1
        return self._answer(call)


class DirectCouncilMultimodalRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.ledger = self.base / "ledger"
        self.receipts = self.base / "receipts"
        self.env = patch.dict(
            os.environ,
            {
                "ENABLE_COUNCIL": "true",
                "COUNCIL_LEDGER_DIR": str(self.ledger),
                "COUNCIL_REQUEST_RECEIPT_DIR": str(self.receipts),
            },
            clear=False,
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.router = RecordingRouter()
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

    @staticmethod
    def _input() -> CouncilInput:
        return CouncilInput(
            messages=MULTIMODAL_MESSAGES,
            task_type="visualization_generation",
            council_mode_override="direct_council",
            garden_id="fixture-garden",
            page_id="learning/fixture.md",
            source_context={"stage": "generated-visual-critic"},
            requested_model_alias="gpt-fixture",
            requested_model="gpt-fixture",
            resolved_model="gpt-fixture",
            max_tokens=6000,
            reasoning_effort="max",
            reasoning_summary="detailed",
        )

    def _payload(self, request_id: str | None = None) -> dict[str, object]:
        council_input = self._input()
        payload: dict[str, object] = {
            "model": "gpt-fixture",
            "messages": council_input.messages,
            "taskType": council_input.task_type,
            "councilModeOverride": council_input.council_mode_override,
            "gardenId": council_input.garden_id,
            "pageId": council_input.page_id,
            "sourceContext": council_input.source_context,
            "max_completion_tokens": council_input.max_tokens,
            "reasoning": {"effort": "max", "summary": "detailed"},
        }
        if request_id is not None:
            payload.update(
                {
                    "clientRequestId": request_id,
                    "clientRequestHash": council_request_hash_v1(
                        council_input,
                        effective_mode="direct_council",
                    ),
                }
            )
        return payload

    def test_explicit_direct_multimodal_reaches_one_council_call_with_image_intact(self) -> None:
        response = self.client.post("/v1/chat/completions", json=self._payload())

        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["councilMode"], "direct_council")
        self.assertEqual(len(self.router.calls), 1)
        self.assertEqual(self.router.calls[0].messages, MULTIMODAL_MESSAGES)
        self.assertEqual(
            self.router.calls[0].messages[1]["content"][1],
            IMAGE_PART,
        )

        snapshot_path = next(self.ledger.glob("crun_*.json"))
        snapshot_text = snapshot_path.read_text(encoding="utf-8")
        self.assertNotIn(IMAGE_BASE64, snapshot_text)
        snapshot = json.loads(snapshot_text)
        stored_image = snapshot["messages"][1]["content"][1]
        self.assertEqual(
            stored_image,
            {
                "type": "image_url",
                "detail": "original",
                "sha256": hashlib.sha256(IMAGE_BYTES).hexdigest(),
                "byteLength": len(IMAGE_BYTES),
            },
        )

    def test_bound_direct_multimodal_completes_resolves_and_duplicate_stays_fenced(self) -> None:
        payload = self._payload("lrq_fixture_multimodal_0001")
        first = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(first.status_code, 200, first.get_json())
        self.assertEqual(len(self.router.calls), 1)
        self.assertEqual(self.router.strict_calls, 1)
        self.assertEqual(self.router.calls[0].messages, MULTIMODAL_MESSAGES)

        receipt_path = self.receipts / f"{payload['clientRequestId']}.json"
        receipt_text = receipt_path.read_text(encoding="utf-8")
        self.assertNotIn(IMAGE_BASE64, receipt_text)
        self.assertEqual(json.loads(receipt_text)["state"], "completed")
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
            '{"visualization":true}',
        )
        self.assertEqual(resolved.get_json()["result"]["usage"]["callCount"], 1)

        duplicate = self.client.post("/v1/chat/completions", json=payload)
        self.assertEqual(duplicate.status_code, 409, duplicate.get_json())
        self.assertEqual(len(self.router.calls), 1)
        self.assertEqual(self.router.strict_calls, 1)

    def test_non_direct_and_unknown_multimodal_requests_do_not_enter_council(self) -> None:
        for mode in (None, "lite_council", "full_council", "evolution_council"):
            payload = {} if mode is None else {"councilModeOverride": mode}
            with self.subTest(mode=mode):
                self.assertIn(
                    "image_url",
                    council_bypass_reason(payload, MULTIMODAL_MESSAGES) or "",
                )

        direct = {"councilModeOverride": "direct_council"}
        self.assertIsNone(council_bypass_reason(direct, MULTIMODAL_MESSAGES))
        self.assertEqual(
            council_bypass_reason(
                {**direct, "tools": [{"type": "function"}]},
                MULTIMODAL_MESSAGES,
            ),
            "function/tool calling request",
        )
        unknown_messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "fixture"},
                    {"type": "input_file", "file_data": IMAGE_BASE64},
                ],
            }
        ]
        self.assertIn(
            "input_file",
            council_bypass_reason(direct, unknown_messages) or "",
        )
        malformed_image = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": IMAGE_URL, "detail": {"unsafe": True}},
                    }
                ],
            }
        ]
        self.assertIn(
            "image_url",
            council_bypass_reason(direct, malformed_image) or "",
        )

        rejected = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-fixture",
                "messages": unknown_messages,
                "councilModeOverride": "direct_council",
                "clientRequestId": "lrq_fixture_unknown_multimodal_0001",
                "clientRequestHash": "a" * 64,
            },
        )
        self.assertEqual(rejected.status_code, 409, rejected.get_json())
        self.assertEqual(len(self.router.calls), 0)
        self.assertFalse(
            (self.receipts / "lrq_fixture_unknown_multimodal_0001.json").exists()
        )


if __name__ == "__main__":
    unittest.main()
