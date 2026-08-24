from __future__ import annotations

import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from chatmock import ask
from chatmock.app import create_app
from chatmock.council.gateway import _resolved_usage
from chatmock.council.ledger import JsonlCouncilLedger
from chatmock.council.policy import CouncilConfig, choose_council_mode
from chatmock.council.runtime import CouncilRuntime
from chatmock.council.types import CouncilInput, CouncilRun
from chatmock.providers.chatgpt_upstream import ChatGptUpstreamProvider
from chatmock.providers.router import ProviderRouter
from chatmock.providers.types import ModelCall, ModelTokenUsage, ProviderError
from chatmock.session import reset_session_state


class FakeUpstream:
    """Minimal stand-in for both legacy SSE and Responses websocket tests."""

    def __init__(self, events: list[dict[str, object]]) -> None:
        self._events = events
        self.sent: list[str] = []
        self.status_code = 200
        self.headers: dict[str, str] = {}
        self.content = b""
        self.text = ""

    def iter_lines(self, decode_unicode: bool = False):
        for event in self._events:
            payload = f"data: {json.dumps(event)}"
            yield payload if decode_unicode else payload.encode("utf-8")

    def send(self, message: str) -> None:
        self.sent.append(message)

    def recv(self, timeout: float | None = None):
        if not self._events:
            return None
        return json.dumps(self._events.pop(0))

    def close(self) -> None:
        return None


def _prompt_text(call: ModelCall) -> str:
    parts = []
    for msg in call.messages or []:
        content = msg.get("content")
        if isinstance(content, str):
            parts.append(content)
    return "\n".join(parts)


class StubRouter:
    """Duck-typed ProviderRouter: deterministic answers, no network."""

    def __init__(
        self,
        fail_models=None,
        fail_chair=False,
        fail_reviews=False,
        fail_messages=None,
        usage_per_call: ModelTokenUsage | None = None,
        reasoning_per_call: str | None = None,
    ) -> None:
        self.calls: list[ModelCall] = []
        self.fail_models = set(fail_models or [])
        self.fail_messages = dict(fail_messages or {})
        self.fail_chair = fail_chair
        self.fail_reviews = fail_reviews
        self.usage_per_call = usage_per_call
        self.reasoning_per_call = reasoning_per_call

    def effective_model(self, model: str) -> str:
        return model

    def call_model(self, call: ModelCall) -> str:
        self.calls.append(call)
        call.usage_out = self.usage_per_call
        call.reasoning_out = self.reasoning_per_call
        system = call.system or ""
        prompt = _prompt_text(call)

        if "Chair Synthesizer" in system:
            if self.fail_chair:
                raise ProviderError("stub chair failure")
            return "FINAL SYNTHESIZED ANSWER"

        if "Respond with a single JSON object" in prompt:
            if self.fail_reviews:
                raise ProviderError("stub review failure")
            labels: list[str] = []
            for label in re.findall(r"Response [A-Z]", prompt):
                if label not in labels:
                    labels.append(label)
            return json.dumps(
                {
                    "rankings": labels,
                    "scores": {label: 9 - index for index, label in enumerate(labels)},
                    "critique": "stub critique",
                    "recommended_winner": labels[0] if labels else None,
                }
            )

        if call.model in self.fail_models:
            raise ProviderError(self.fail_messages.get(call.model, f"stub failure for {call.model}"))

        if "improving a Breadboard artifact" in system:
            return f"IMPROVED ARTIFACT from {call.model}"

        return f"CANDIDATE ANSWER from {call.model}"


class ChatGptUpstreamProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.telemetry = tempfile.TemporaryDirectory()
        self.addCleanup(self.telemetry.cleanup)
        patcher = patch.dict(
            os.environ,
            {
                "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(
                    self.telemetry.name, "model-routing.jsonl"
                )
            },
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        account_patcher = patch(
            "chatmock.providers.chatgpt_upstream.select_account",
            return_value=None,
        )
        auth_patcher = patch(
            "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
            return_value=("token", "account"),
        )
        account_patcher.start()
        auth_patcher.start()
        self.addCleanup(account_patcher.stop)
        self.addCleanup(auth_patcher.stop)

    @patch("chatmock.providers.chatgpt_upstream.record_rate_limits_from_response")
    @patch("chatmock.providers.chatgpt_upstream.connect_upstream_websocket")
    def test_request_reasoning_overrides_server_defaults(self, mock_start, _mock_record) -> None:
        upstream = FakeUpstream(
            [
                {"type": "response.output_text.delta", "delta": "hello"},
                {"type": "response.completed", "response": {"id": "resp_reasoning"}},
            ]
        )
        mock_start.return_value = upstream
        call = ModelCall(
            model="gpt-5.6-sol",
            messages=[{"role": "user", "content": "hi"}],
            reasoning_effort="high",
            reasoning_summary="detailed",
        )

        ChatGptUpstreamProvider(reasoning_effort="low", reasoning_summary="none").call_model(call)

        self.assertEqual(
            json.loads(upstream.sent[0])["reasoning"],
            {"effort": "high", "summary": "detailed"},
        )

    @patch("chatmock.providers.chatgpt_upstream.record_rate_limits_from_response")
    @patch("chatmock.providers.chatgpt_upstream.connect_upstream_websocket")
    def test_records_rate_limit_headers_for_council_calls(self, mock_start, mock_record) -> None:
        upstream = FakeUpstream(
            [
                {"type": "response.output_text.delta", "delta": "hello"},
                {"type": "response.completed", "response": {"id": "resp_1"}},
            ]
        )
        upstream.headers = {"x-codex-primary-used-percent": "7.5"}
        mock_start.return_value = upstream

        provider = ChatGptUpstreamProvider(reasoning_effort="low", reasoning_summary="none")
        text = provider.call_model(
            ModelCall(model="gpt-5.4", messages=[{"role": "user", "content": "hi"}])
        )

        self.assertEqual(text, "hello")
        mock_record.assert_called_once_with(upstream)

    @patch("chatmock.providers.chatgpt_upstream.record_rate_limits_from_response")
    @patch("chatmock.providers.chatgpt_upstream.connect_upstream_websocket")
    def test_captures_responses_token_usage(self, mock_start, _mock_record) -> None:
        mock_start.return_value = FakeUpstream(
            [
                {"type": "response.output_text.delta", "delta": "hello"},
                {
                    "type": "response.completed",
                    "response": {
                        "id": "resp_usage",
                        "usage": {
                            "input_tokens": 11,
                            "input_tokens_details": {"cached_tokens": 3},
                            "output_tokens": 7,
                            "output_tokens_details": {"reasoning_tokens": 2},
                            "total_tokens": 18,
                        },
                    },
                },
            ]
        )
        call = ModelCall(model="gpt-5.4", messages=[{"role": "user", "content": "hi"}])

        ChatGptUpstreamProvider().call_model(call)

        self.assertEqual(
            call.usage_out,
            ModelTokenUsage(
                input_tokens=11,
                output_tokens=7,
                total_tokens=18,
                cached_input_tokens=3,
                reasoning_tokens=2,
            ),
        )

    @patch("chatmock.providers.chatgpt_upstream.record_rate_limits_from_response")
    @patch("chatmock.providers.chatgpt_upstream.connect_upstream_websocket")
    def test_captures_usage_from_an_incomplete_terminal_response(
        self,
        mock_start,
        _mock_record,
    ) -> None:
        mock_start.return_value = FakeUpstream(
            [
                {"type": "response.output_text.delta", "delta": "partial"},
                {
                    "type": "response.incomplete",
                    "response": {
                        "usage": {
                            "input_tokens": 14,
                            "output_tokens": 6,
                            "total_tokens": 20,
                        }
                    },
                },
            ]
        )
        call = ModelCall(model="gpt-5.4", messages=[{"role": "user", "content": "hi"}])

        self.assertEqual(ChatGptUpstreamProvider().call_model(call), "partial")
        self.assertEqual(call.usage_out, ModelTokenUsage(14, 6, 20))

    @patch("chatmock.providers.chatgpt_upstream.record_rate_limits_from_response")
    @patch("chatmock.providers.chatgpt_upstream.connect_upstream_websocket")
    def test_ignores_partial_responses_token_usage(self, mock_start, _mock_record) -> None:
        mock_start.return_value = FakeUpstream(
            [
                {"type": "response.output_text.delta", "delta": "hello"},
                {
                    "type": "response.completed",
                    "response": {
                        "id": "resp_partial_usage",
                        "usage": {"input_tokens": 11, "output_tokens": 7},
                    },
                },
            ]
        )
        call = ModelCall(model="gpt-5.4", messages=[{"role": "user", "content": "hi"}])

        ChatGptUpstreamProvider().call_model(call)

        self.assertIsNone(call.usage_out)

    def test_provider_router_propagates_reasoning_and_usage_out_params(self) -> None:
        usage = ModelTokenUsage(11, 7, 18, 3, 2)
        routed_calls: list[ModelCall] = []

        class UsageUpstream:
            def call_model(self, routed_call: ModelCall) -> str:
                routed_calls.append(routed_call)
                routed_call.reasoning_out = "checked"
                routed_call.usage_out = usage
                return "answer"

        router = ProviderRouter(CouncilConfig(), upstream=UsageUpstream())
        call = ModelCall(
            model="gpt-5.4",
            messages=[{"role": "user", "content": "hi"}],
            reasoning_effort="high",
            reasoning_summary="detailed",
        )

        self.assertEqual(router.call_model(call), "answer")
        self.assertEqual(call.reasoning_out, "checked")
        self.assertEqual(call.usage_out, usage)
        self.assertEqual(call.model_attempts_out[0]["upstreamModel"], "gpt-5.4")
        self.assertEqual(call.model_attempts_out[0]["outcome"], "succeeded")
        self.assertEqual(routed_calls[0].reasoning_effort, "high")
        self.assertEqual(routed_calls[0].reasoning_summary, "detailed")


class CouncilRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = CouncilConfig(
            council_models=["gpt-test-a", "gpt-test-b", "gpt-test-c"],
            chairman_model="gpt-test-chairman",
            evolution_candidates=2,
        )

    def _runtime(self, **router_kwargs) -> tuple[CouncilRuntime, StubRouter]:
        router = StubRouter(**router_kwargs)
        runtime = CouncilRuntime(
            config=self.config,
            router=router,
            ledger=JsonlCouncilLedger(self.tmp.name),
        )
        return runtime, router

    def test_direct_council_returns_final_answer(self) -> None:
        runtime, router = self._runtime()
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "hi"}],
                requested_model="gpt-test",
            )
        )
        self.assertEqual(run.council_mode, "direct_council")
        self.assertEqual(run.final_answer, "CANDIDATE ANSWER from gpt-test")
        self.assertEqual(len(run.candidates), 1)
        self.assertEqual(len(router.calls), 1)

    def test_direct_council_exposes_model_reasoning_summary(self) -> None:
        runtime, _ = self._runtime(reasoning_per_call="Checked the relevant context.")
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "hi"}],
                requested_model="gpt-test",
            )
        )

        self.assertEqual(run.reasoning_summary, "Checked the relevant context.")
        self.assertEqual(run.to_dict()["reasoningSummary"], "Checked the relevant context.")

    def test_reasoning_overrides_reach_every_council_model_call(self) -> None:
        runtime, router = self._runtime()
        runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "build the topic map"}],
                task_type="topic_map",
                reasoning_effort="high",
                reasoning_summary="detailed",
            )
        )

        self.assertTrue(router.calls)
        self.assertEqual({call.reasoning_effort for call in router.calls}, {"high"})
        self.assertEqual({call.reasoning_summary for call in router.calls}, {"detailed"})

    def test_lite_council_returns_answer_and_one_review(self) -> None:
        runtime, _ = self._runtime()
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "revise this paragraph"}],
                task_type="small_revision",
            )
        )
        self.assertEqual(run.council_mode, "lite_council")
        self.assertEqual(run.final_answer, "FINAL SYNTHESIZED ANSWER")
        self.assertEqual(len(run.candidates), 1)
        self.assertEqual(len(run.reviews), 1)

    def test_full_council_produces_candidates_reviews_ranking_and_answer(self) -> None:
        runtime, _ = self._runtime()
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "build the topic map"}],
                task_type="topic_map",
            )
        )
        self.assertEqual(run.council_mode, "full_council")
        self.assertEqual(len(run.candidates), 3)
        self.assertEqual(len(run.reviews), 5)
        self.assertIsNotNone(run.aggregate_ranking)
        self.assertEqual(len(run.aggregate_ranking.ordered_candidate_ids), 3)
        self.assertEqual(run.final_answer, "FINAL SYNTHESIZED ANSWER")
        anonymized = {c.anonymized_id for c in run.candidates}
        self.assertEqual(len(anonymized), 3)

    def test_full_council_aggregates_usage_from_every_parallel_call(self) -> None:
        per_call = ModelTokenUsage(11, 7, 18, 3, 2)
        runtime, _ = self._runtime(usage_per_call=per_call)
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "build the topic map"}],
                task_type="topic_map",
            )
        )

        usage = run.token_usage_snapshot()
        self.assertEqual(usage.call_count, 9)
        self.assertEqual(usage.reported_call_count, 9)
        self.assertTrue(usage.fully_reported)
        self.assertEqual(usage.input_tokens, 99)
        self.assertEqual(usage.output_tokens, 63)
        self.assertEqual(usage.total_tokens, 162)
        self.assertEqual(usage.cached_input_tokens, 27)
        self.assertEqual(usage.reasoning_tokens, 18)

    def test_partial_usage_fallback_never_drops_known_authoritative_totals(self) -> None:
        run = CouncilRun(
            id="crun_partial_usage",
            user_prompt="hi",
            messages=[{"role": "user", "content": "hi"}],
            council_mode="full_council",
            final_answer="ok",
        )
        run.record_model_call_usage(
            input_tokens=900,
            output_tokens=100,
            total_tokens=1000,
            cached_input_tokens=400,
            reasoning_tokens=25,
        )
        run.record_model_call_usage()

        usage, estimated = _resolved_usage(run)

        self.assertTrue(estimated)
        self.assertGreaterEqual(usage.input_tokens, 900)
        self.assertGreaterEqual(usage.output_tokens, 100)
        self.assertGreaterEqual(usage.total_tokens, 1000)
        self.assertEqual(usage.cached_input_tokens, 400)
        self.assertEqual(usage.reasoning_tokens, 25)

    def test_legacy_external_seats_use_requested_chatgpt_model(self) -> None:
        router = StubRouter()
        runtime = CouncilRuntime(
            config=CouncilConfig(
                council_models=["legacy/model-a", "legacy/model-b", "legacy/model-c"],
                chairman_model="legacy/chairman",
            ),
            router=router,
            ledger=JsonlCouncilLedger(self.tmp.name),
        )
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "build the topic map"}],
                task_type="topic_map",
                requested_model="gpt-5.5",
            )
        )
        self.assertEqual(run.final_answer, "FINAL SYNTHESIZED ANSWER")
        self.assertTrue(router.calls)
        self.assertEqual({call.model for call in router.calls}, {"gpt-5.5"})

    def test_partial_candidate_failure_continues_with_the_rest(self) -> None:
        runtime, _ = self._runtime(fail_models={"gpt-test-b"})
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "build the topic map"}],
                task_type="topic_map",
            )
        )
        self.assertEqual(len(run.candidates), 2)
        self.assertEqual(run.final_answer, "FINAL SYNTHESIZED ANSWER")
        self.assertTrue(run.diagnostics.get("candidateFailures"))

    def test_all_candidate_failures_yield_failed_run(self) -> None:
        runtime, _ = self._runtime(
            fail_models={"gpt-test-a", "gpt-test-b", "gpt-test-c"}
        )
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "build the topic map"}],
                task_type="topic_map",
            )
        )
        self.assertEqual(run.final_answer, "")
        self.assertIn("error", run.diagnostics)

    def test_review_failure_still_synthesizes_from_candidates(self) -> None:
        runtime, _ = self._runtime(fail_reviews=True)
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "build the topic map"}],
                task_type="topic_map",
            )
        )
        self.assertEqual(len(run.reviews), 0)
        self.assertEqual(run.final_answer, "FINAL SYNTHESIZED ANSWER")
        self.assertTrue(run.diagnostics.get("reviewFailures"))

    def test_synthesis_failure_falls_back_to_a_candidate(self) -> None:
        runtime, _ = self._runtime(fail_chair=True)
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "build the topic map"}],
                task_type="topic_map",
            )
        )
        self.assertTrue(run.final_answer.startswith("CANDIDATE ANSWER from "))
        self.assertIn("synthesisFailure", run.diagnostics)

    def test_council_run_is_persisted(self) -> None:
        runtime, _ = self._runtime(usage_per_call=ModelTokenUsage(11, 7, 18, 3, 2))
        run = runtime.run(
            CouncilInput(messages=[{"role": "user", "content": "hi"}], requested_model="gpt-test")
        )
        base = Path(self.tmp.name)
        run_file = base / f"{run.id}.json"
        self.assertTrue(run_file.exists())
        saved = json.loads(run_file.read_text(encoding="utf-8"))
        self.assertEqual(saved["requestedModel"], "gpt-test")
        self.assertEqual(saved["resolvedModel"], "gpt-test")
        self.assertEqual(saved["modelRouting"], [])
        self.assertEqual(
            saved["usage"],
            {
                "inputTokens": 11,
                "outputTokens": 7,
                "totalTokens": 18,
                "cachedInputTokens": 3,
                "reasoningTokens": 2,
                "callCount": 1,
                "reportedCallCount": 1,
            },
        )
        events_file = base / f"{run.id}.events.jsonl"
        self.assertTrue(events_file.exists())
        event_types = [
            json.loads(line)["type"]
            for line in events_file.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.assertIn("council_run_created", event_types)
        self.assertIn("council_candidate_generated", event_types)
        self.assertIn("council_final_synthesized", event_types)

    def test_council_run_persists_requested_resolved_and_served_models(self) -> None:
        class TraceRouter(StubRouter):
            def call_model(self, call: ModelCall) -> str:
                result = super().call_model(call)
                call.model_attempts_out.append(
                    {
                        "requestId": call.request_id,
                        "requestedModel": call.client_requested_model,
                        "callModel": call.model,
                        "resolvedModel": "cliproxy/claude-opus-5",
                        "upstreamModel": "claude-opus-5",
                        "provider": "cliproxy",
                        "outcome": "succeeded",
                        "fallback": False,
                    }
                )
                return result

        runtime = CouncilRuntime(
            config=self.config,
            router=TraceRouter(),
            ledger=JsonlCouncilLedger(self.tmp.name),
        )
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "hi"}],
                requested_model_alias="default",
                resolved_model="cliproxy/claude-opus-5",
                requested_model="cliproxy/claude-opus-5",
            )
        )

        saved = json.loads(
            (Path(self.tmp.name) / f"{run.id}.json").read_text(encoding="utf-8")
        )
        self.assertEqual(saved["requestedModel"], "default")
        self.assertEqual(saved["resolvedModel"], "cliproxy/claude-opus-5")
        self.assertEqual(saved["modelRouting"][0]["upstreamModel"], "claude-opus-5")
        self.assertEqual(saved["modelRouting"][0]["provider"], "cliproxy")
        self.assertFalse(saved["modelRouting"][0]["fallback"])

    def test_evolution_council_creates_versioned_nodes(self) -> None:
        runtime, _ = self._runtime()
        run = runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "improve the subsection prompt"}],
                task_type="prompt_improvement",
                source_context={
                    "artifact": "You write subsections.",
                    "artifactType": "prompt",
                    "goal": "More source-aware.",
                },
            )
        )
        self.assertEqual(run.council_mode, "evolution_council")
        summary = json.loads(run.final_answer)
        self.assertEqual(len(summary["nodes"]), 2)
        statuses = {node["status"] for node in summary["nodes"]}
        self.assertTrue(statuses <= {"promoted", "rejected"})
        promoted = [node for node in summary["nodes"] if node["status"] == "promoted"]
        self.assertLessEqual(len(promoted), 1)
        evo_dir = Path(self.tmp.name) / "evolution"
        self.assertEqual(len(list(evo_dir.glob("evo_*.json"))), 2)


class CouncilModeSelectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = CouncilConfig()

    def _input(self, **kwargs) -> CouncilInput:
        kwargs.setdefault("messages", [{"role": "user", "content": "hello"}])
        return CouncilInput(**kwargs)

    def test_full_council_task_types(self) -> None:
        for task in (
            "subsection_generation",
            "section_generation",
            "topic_map",
            "learning_spine",
            "source_synthesis",
            "source_map",
            "scope_contract",
            "exam_question_generation",
            "full_page_revision",
        ):
            self.assertEqual(choose_council_mode(self._input(task_type=task), self.config), "full_council")

    def test_lite_council_task_types(self) -> None:
        for task in ("visualization_generation", "small_revision", "critique", "note_generation"):
            self.assertEqual(choose_council_mode(self._input(task_type=task), self.config), "lite_council")

    def test_direct_council_task_types(self) -> None:
        for task in ("tagging", "classification", "metadata_generation", "knowledge_extraction"):
            self.assertEqual(choose_council_mode(self._input(task_type=task), self.config), "direct_council")

    def test_lite_task_upgrades_to_full_for_large_context(self) -> None:
        council_input = self._input(
            task_type="visualization_generation",
            source_context={"text": "x" * (self.config.large_context_chars + 1)},
        )
        self.assertEqual(choose_council_mode(council_input, self.config), "full_council")

    def test_page_assistant_short_prompt_without_context_is_direct(self) -> None:
        council_input = self._input(task_type="page_assistant_answer")
        self.assertEqual(choose_council_mode(council_input, self.config), "direct_council")

    def test_page_assistant_with_source_context_is_lite(self) -> None:
        council_input = self._input(
            task_type="page_assistant_answer",
            source_context={"sourceTitles": ["lecture-1.pdf"]},
        )
        self.assertEqual(choose_council_mode(council_input, self.config), "lite_council")

    def test_page_assistant_long_prompt_is_lite(self) -> None:
        council_input = self._input(
            task_type="page_assistant_answer",
            messages=[{"role": "user", "content": "x" * (self.config.short_prompt_chars + 1)}],
        )
        self.assertEqual(choose_council_mode(council_input, self.config), "lite_council")

    def test_page_assistant_never_escalates_to_full(self) -> None:
        council_input = self._input(
            task_type="page_assistant_answer",
            source_context={"text": "x" * (self.config.large_context_chars + 1)},
        )
        self.assertEqual(choose_council_mode(council_input, self.config), "lite_council")

    def test_ocr_is_direct_without_context_and_lite_with_context(self) -> None:
        self.assertEqual(choose_council_mode(self._input(task_type="ocr"), self.config), "direct_council")
        with_context = self._input(task_type="ocr", source_context={"figureSummaries": ["fig 1"]})
        self.assertEqual(choose_council_mode(with_context, self.config), "lite_council")

    def test_evolution_task_types(self) -> None:
        for task in ("prompt_improvement", "template_improvement", "policy_improvement", "artifact_evolution"):
            self.assertEqual(choose_council_mode(self._input(task_type=task), self.config), "evolution_council")

    def test_short_untagged_prompt_uses_direct(self) -> None:
        self.assertEqual(choose_council_mode(self._input(), self.config), "direct_council")

    def test_override_wins(self) -> None:
        council_input = self._input(task_type="topic_map", council_mode_override="lite_council")
        self.assertEqual(choose_council_mode(council_input, self.config), "lite_council")


class CouncilRouteTests(unittest.TestCase):
    """The ChatMock API contract: every normal chat request is council-mediated."""

    def setUp(self) -> None:
        reset_session_state()
        os.environ["ENABLE_COUNCIL"] = "true"
        self.addCleanup(lambda: os.environ.pop("ENABLE_COUNCIL", None))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        routing_env = patch.dict(
            os.environ,
            {
                "CHATMOCK_DEFAULT_MODEL": "gpt-5.6-sol",
                "CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json"),
                "CHATMOCK_FAILOVER_FILE": os.path.join(self.tmp.name, "failover.json"),
                "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(self.tmp.name, "model-routing.jsonl"),
            },
            clear=False,
        )
        routing_env.start()
        self.addCleanup(routing_env.stop)
        self.router = StubRouter()
        runtime = CouncilRuntime(
            config=CouncilConfig(
                council_models=["gpt-test-a", "gpt-test-b", "gpt-test-c"],
                chairman_model="gpt-test-chairman",
            ),
            router=self.router,
            ledger=JsonlCouncilLedger(self.tmp.name),
        )
        ask.set_council_runtime(runtime)
        self.addCleanup(lambda: ask.set_council_runtime(None))
        self.app = create_app()
        self.client = self.app.test_client()

    def test_chat_completions_goes_through_chatmock_ask(self) -> None:
        canned = CouncilRun(
            id="crun_test",
            user_prompt="hi",
            messages=[{"role": "user", "content": "hi"}],
            council_mode="direct_council",
            final_answer="canned answer",
        )
        with patch("chatmock.council.gateway.chatmock_ask", return_value=canned) as mock_ask:
            response = self.client.post(
                "/v1/chat/completions",
                json={"model": "gpt-5.4", "messages": [{"role": "user", "content": "hi"}]},
            )
        self.assertEqual(response.status_code, 200)
        mock_ask.assert_called_once()
        body = response.get_json()
        self.assertEqual(body["choices"][0]["message"]["content"], "canned answer")
        self.assertEqual(body["councilRunId"], "crun_test")
        self.assertTrue(body["usageEstimated"])

    def test_response_preserves_shape_and_adds_council_run_id(self) -> None:
        self.router.usage_per_call = ModelTokenUsage(11, 7, 18, 3, 2)
        response = self.client.post(
            "/v1/chat/completions",
            json={"model": "gpt-5.4", "messages": [{"role": "user", "content": "hi"}]},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        # Existing UI contract: assistant text in choices[0].message.content.
        self.assertEqual(body["object"], "chat.completion")
        self.assertEqual(body["choices"][0]["message"]["role"], "assistant")
        self.assertTrue(body["choices"][0]["message"]["content"].startswith("CANDIDATE ANSWER"))
        self.assertEqual(body["choices"][0]["finish_reason"], "stop")
        self.assertEqual(body["model"], "gpt-5.4")
        self.assertEqual(
            body["usage"],
            {
                "prompt_tokens": 11,
                "completion_tokens": 7,
                "total_tokens": 18,
                "prompt_tokens_details": {"cached_tokens": 3},
                "completion_tokens_details": {"reasoning_tokens": 2},
            },
        )
        self.assertFalse(body["usageEstimated"])
        # Council extensions.
        self.assertTrue(body["councilRunId"].startswith("crun_"))
        self.assertEqual(body["councilMode"], "direct_council")
        self.assertNotIn("council", body)

    def test_streaming_response_carries_final_answer(self) -> None:
        self.router.usage_per_call = ModelTokenUsage(11, 7, 18, 3, 2)
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "stream": True,
                "stream_options": {"include_usage": True},
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        self.assertEqual(response.status_code, 200)
        text = response.get_data(as_text=True)
        self.assertIn("CANDIDATE ANSWER", text)
        self.assertIn("councilRunId", text)
        self.assertIn("data: [DONE]", text)
        events = [
            json.loads(line[len("data: ") :])
            for line in text.splitlines()
            if line.startswith("data: {")
        ]
        usage_event = next(event for event in events if event.get("choices") == [])
        self.assertEqual(usage_event["usage"]["total_tokens"], 18)
        self.assertEqual(usage_event["usage"]["prompt_tokens_details"]["cached_tokens"], 3)
        self.assertEqual(usage_event["usage"]["completion_tokens_details"]["reasoning_tokens"], 2)
        self.assertFalse(usage_event["usageEstimated"])

    def test_council_chat_response_exposes_reasoning_for_thinking_panel(self) -> None:
        self.router.reasoning_per_call = "Checked the relevant context."
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        message = response.get_json()["choices"][0]["message"]
        self.assertEqual(message["reasoning_content"], "Checked the relevant context.")

        streamed = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "stream": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
        ).get_data(as_text=True)
        events = [
            json.loads(line[len("data: ") :])
            for line in streamed.splitlines()
            if line.startswith("data: {")
        ]
        reasoning = "".join(
            event["choices"][0]["delta"].get("reasoning_content", "")
            for event in events
            if event.get("choices")
        )
        self.assertEqual(reasoning, "Checked the relevant context.")

    def test_diagnostics_only_when_requested(self) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": "hi"}],
                "includeCouncilDiagnostics": True,
            },
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertIn("council", body)
        self.assertEqual(len(body["council"]["candidates"]), 1)
        self.assertEqual(body["council"]["finalAnswer"], body["choices"][0]["message"]["content"])

    def test_task_type_selects_full_council(self) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": "map the topics"}],
                "taskType": "topic_map",
            },
        )
        body = response.get_json()
        self.assertEqual(body["councilMode"], "full_council")
        self.assertEqual(body["choices"][0]["message"]["content"], "FINAL SYNTHESIZED ANSWER")

    def test_all_provider_failures_return_clean_error(self) -> None:
        self.router.fail_models = {"gpt-test-a", "gpt-test-b", "gpt-test-c", "gpt-5.4"}
        response = self.client.post(
            "/v1/chat/completions",
            json={"model": "gpt-5.4", "messages": [{"role": "user", "content": "hi"}]},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 502)
        self.assertIn("could not produce an answer", body["error"]["message"])
        self.assertNotIn("stub failure", body["error"]["message"])
        self.assertIn("councilRunId", body)

    def test_upstream_429_returns_actionable_error(self) -> None:
        self.router.fail_models = {"gpt-5.4"}
        self.router.fail_messages = {
            "gpt-5.4": "chatgpt upstream returned HTTP 429 for gpt-5.4",
        }
        response = self.client.post(
            "/v1/chat/completions",
            json={"model": "gpt-5.4", "messages": [{"role": "user", "content": "hi"}]},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 502)
        self.assertIn("HTTP 429", body["error"]["message"])
        self.assertIn("gpt-5.4", body["error"]["message"])
        self.assertNotIn("chatgpt upstream returned", body["error"]["message"])

    def test_account_refusal_names_the_account_not_the_candidates(self) -> None:
        # Every candidate fails identically when the signed-in ChatGPT account
        # has no Codex access, and "all candidate models failed" sends the
        # reader looking at models instead of at the account.
        self.router.fail_models = {"gpt-test-a", "gpt-test-b", "gpt-test-c", "gpt-5.4"}
        self.router.fail_messages = {
            "gpt-5.4": (
                "HTTP 400: The 'gpt-5.4' model is not supported when using Codex "
                "with a ChatGPT account."
            ),
        }
        response = self.client.post(
            "/v1/chat/completions",
            json={"model": "gpt-5.4", "messages": [{"role": "user", "content": "hi"}]},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 502)
        self.assertIn("account", body["error"]["message"])
        self.assertIn("Settings", body["error"]["message"])
        self.assertNotIn("all candidate models failed", body["error"]["message"])

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_tool_requests_bypass_council(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "tool answer"},
                    {"type": "response.completed", "response": {"id": "resp-tools"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": "hi"}],
                "tools": [
                    {
                        "type": "function",
                        "function": {"name": "f", "parameters": {"type": "object", "properties": {}}},
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        mock_start.assert_called_once()
        body = response.get_json()
        self.assertNotIn("councilRunId", body)

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_image_parts_bypass_council(self, mock_start) -> None:
        """An attached image has to reach the model, and the council flattens
        content to text — so the whole request goes upstream verbatim."""
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "a word grid"},
                    {"type": "response.completed", "response": {"id": "resp-image"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "what is in this picture?"},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": "data:image/png;base64,AAAA",
                                    "detail": "low",
                                },
                            },
                        ],
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        mock_start.assert_called_once()
        body = response.get_json()
        self.assertNotIn("councilRunId", body)
        self.assertEqual(body["choices"][0]["message"]["content"], "a word grid")
        # The image survives the chat -> responses conversion as a real image
        # part rather than the council's "[image attachment]" placeholder.
        outbound = mock_start.call_args.args[1]
        parts = [part for item in outbound for part in item.get("content", [])]
        self.assertIn("input_image", [part.get("type") for part in parts])
        image_part = next(part for part in parts if part.get("type") == "input_image")
        self.assertEqual(image_part.get("detail"), "low")

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_enable_council_false_bypasses_council(self, mock_start) -> None:
        os.environ["ENABLE_COUNCIL"] = "false"
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "legacy answer"},
                    {"type": "response.completed", "response": {"id": "resp-legacy"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={"model": "gpt-5.4", "messages": [{"role": "user", "content": "hi"}]},
        )
        self.assertEqual(response.status_code, 200)
        mock_start.assert_called_once()
        self.assertEqual(response.get_json()["choices"][0]["message"]["content"], "legacy answer")

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_council_false_field_bypasses_council(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "legacy answer"},
                    {"type": "response.completed", "response": {"id": "resp-legacy"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "council": False,
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        self.assertEqual(response.status_code, 200)
        mock_start.assert_called_once()
        self.assertNotIn("councilRunId", response.get_json())

    def test_source_context_and_metadata_reach_council_input(self) -> None:
        canned = CouncilRun(
            id="crun_ctx",
            user_prompt="write it",
            messages=[{"role": "user", "content": "write it"}],
            council_mode="full_council",
            final_answer="ok",
        )
        source_context = {
            "sourceIds": ["src-1"],
            "sourceTitles": ["Waves lecture 5"],
            "figureSummaries": ["Fig 3: standing wave modes"],
        }
        with patch("chatmock.council.gateway.chatmock_ask", return_value=canned) as mock_ask:
            response = self.client.post(
                "/v1/chat/completions",
                json={
                    "model": "gpt-5.4",
                    "messages": [{"role": "user", "content": "write it"}],
                    "taskType": "subsection_generation",
                    "gardenId": "physics-for-ee",
                    "pageId": "standing-waves",
                    "sourceContext": source_context,
                    "reasoning": {"effort": "high", "summary": "detailed"},
                },
            )
        self.assertEqual(response.status_code, 200)
        council_input = mock_ask.call_args.args[0]
        self.assertEqual(council_input.task_type, "subsection_generation")
        self.assertEqual(council_input.garden_id, "physics-for-ee")
        self.assertEqual(council_input.page_id, "standing-waves")
        self.assertEqual(council_input.source_context, source_context)
        self.assertEqual(council_input.reasoning_effort, "high")
        self.assertEqual(council_input.reasoning_summary, "detailed")

    def test_top_level_reasoning_effort_reaches_council_input(self) -> None:
        """A council-mediated request must read the Chat Completions field too.

        It is the form every OpenAI SDK client sends, so reading only the
        Responses-shaped object left the seats running at the server default.
        """
        canned = CouncilRun(
            id="crun_effort",
            user_prompt="write it",
            messages=[{"role": "user", "content": "write it"}],
            council_mode="full_council",
            final_answer="ok",
        )
        with patch("chatmock.council.gateway.chatmock_ask", return_value=canned) as mock_ask:
            response = self.client.post(
                "/v1/chat/completions",
                json={
                    "model": "gpt-5.4",
                    "messages": [{"role": "user", "content": "write it"}],
                    "reasoning_effort": "high",
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_ask.call_args.args[0].reasoning_effort, "high")

    def test_task_type_subsection_generation_selects_full_council(self) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": "write the subsection"}],
                "taskType": "subsection_generation",
            },
        )
        body = response.get_json()
        self.assertEqual(body["councilMode"], "full_council")
        self.assertEqual(body["choices"][0]["message"]["content"], "FINAL SYNTHESIZED ANSWER")

    def test_task_type_tagging_selects_direct_council(self) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": "tag these notes"}],
                "taskType": "tagging",
            },
        )
        body = response.get_json()
        self.assertEqual(body["councilMode"], "direct_council")

    def test_council_mode_override_wins_over_task_type(self) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": "map the topics"}],
                "taskType": "topic_map",
                "councilModeOverride": "lite_council",
            },
        )
        body = response.get_json()
        self.assertEqual(body["councilMode"], "lite_council")


class CouncilResponsesRouteTests(unittest.TestCase):
    """Second pass: text-only /v1/responses requests are council-mediated."""

    def setUp(self) -> None:
        reset_session_state()
        os.environ["ENABLE_COUNCIL"] = "true"
        self.addCleanup(lambda: os.environ.pop("ENABLE_COUNCIL", None))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        routing_env = patch.dict(
            os.environ,
            {
                "CHATMOCK_DEFAULT_MODEL": "gpt-5.6-sol",
                "CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json"),
                "CHATMOCK_FAILOVER_FILE": os.path.join(self.tmp.name, "failover.json"),
                "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(self.tmp.name, "model-routing.jsonl"),
            },
            clear=False,
        )
        routing_env.start()
        self.addCleanup(routing_env.stop)
        self.router = StubRouter()
        runtime = CouncilRuntime(
            config=CouncilConfig(
                council_models=["gpt-test-a", "gpt-test-b", "gpt-test-c"],
                chairman_model="gpt-test-chairman",
            ),
            router=self.router,
            ledger=JsonlCouncilLedger(self.tmp.name),
        )
        ask.set_council_runtime(runtime)
        self.addCleanup(lambda: ask.set_council_runtime(None))
        self.app = create_app()
        self.client = self.app.test_client()

    def test_text_only_request_is_council_mediated(self) -> None:
        response = self.client.post(
            "/v1/responses",
            json={"model": "gpt-5.4", "input": "hello"},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["object"], "response")
        self.assertEqual(body["status"], "completed")
        self.assertTrue(body["councilRunId"].startswith("crun_"))
        self.assertEqual(body["councilMode"], "direct_council")
        self.assertEqual(body["metadata"]["councilMode"], "direct_council")
        self.assertTrue(body["usageEstimated"])
        text = body["output"][0]["content"][0]["text"]
        self.assertTrue(text.startswith("CANDIDATE ANSWER"))

    def test_default_alias_and_resolved_model_are_persisted_separately(self) -> None:
        response = self.client.post(
            "/v1/responses",
            json={"model": "default", "input": "hello"},
        )

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["model"], "gpt-5.6-sol")
        routing = body["metadata"]["chatmockModelRouting"]
        self.assertEqual(routing["requestedModel"], "default")
        self.assertEqual(routing["resolvedModel"], "gpt-5.6-sol")
        self.assertEqual(response.headers["X-ChatMock-Requested-Model"], "default")
        self.assertEqual(response.headers["X-ChatMock-Resolved-Model"], "gpt-5.6-sol")

        saved = json.loads(
            (Path(self.tmp.name) / f"{body['councilRunId']}.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(saved["requestedModel"], "default")
        self.assertEqual(saved["resolvedModel"], "gpt-5.6-sol")

    def test_task_type_and_source_context_select_lite_council(self) -> None:
        response = self.client.post(
            "/v1/responses",
            json={
                "model": "gpt-5.4",
                "instructions": "You are the garden assistant.",
                "input": [
                    {
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": "explain standing waves"}],
                    }
                ],
                "taskType": "page_assistant_answer",
                "sourceContext": {"sourceTitles": ["waves.pdf"]},
            },
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["councilMode"], "lite_council")
        self.assertEqual(body["output"][0]["content"][0]["text"], "FINAL SYNTHESIZED ANSWER")

    def test_streaming_request_fabricates_responses_sse(self) -> None:
        self.router.usage_per_call = ModelTokenUsage(11, 7, 18, 3, 2)
        response = self.client.post(
            "/v1/responses",
            json={"model": "gpt-5.4", "input": "hello", "stream": True},
        )
        self.assertEqual(response.status_code, 200)
        text = response.get_data(as_text=True)
        self.assertIn("response.created", text)
        self.assertIn("response.output_text.delta", text)
        self.assertIn("CANDIDATE ANSWER", text)
        self.assertIn("response.completed", text)
        self.assertIn("councilRunId", text)
        events = [
            json.loads(line[len("data: ") :])
            for line in text.splitlines()
            if line.startswith("data: {")
        ]
        completed = next(event for event in events if event.get("type") == "response.completed")
        completed_response = completed["response"]
        self.assertEqual(
            completed_response["usage"],
            {
                "input_tokens": 11,
                "output_tokens": 7,
                "total_tokens": 18,
                "input_tokens_details": {"cached_tokens": 3},
                "output_tokens_details": {"reasoning_tokens": 2},
            },
        )
        self.assertFalse(completed_response["usageEstimated"])

    def test_responses_api_exposes_reasoning_summary(self) -> None:
        self.router.reasoning_per_call = "Checked the relevant context."
        response = self.client.post(
            "/v1/responses",
            json={"model": "gpt-5.4", "input": "hello"},
        )
        output = response.get_json()["output"]
        self.assertEqual(output[0]["type"], "reasoning")
        self.assertEqual(output[0]["summary"][0]["text"], "Checked the relevant context.")
        self.assertEqual(output[1]["type"], "message")

        streamed = self.client.post(
            "/v1/responses",
            json={"model": "gpt-5.4", "input": "hello", "stream": True},
        ).get_data(as_text=True)
        events = [
            json.loads(line[len("data: ") :])
            for line in streamed.splitlines()
            if line.startswith("data: {")
        ]
        summary = "".join(
            event.get("delta", "")
            for event in events
            if event.get("type") == "response.reasoning_summary_text.delta"
        )
        self.assertEqual(summary, "Checked the relevant context.")

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_tool_request_bypasses_and_strips_council_fields(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.created", "response": {"id": "resp_1", "object": "response"}},
                    {
                        "type": "response.completed",
                        "response": {"id": "resp_1", "object": "response", "status": "completed", "output": []},
                    },
                ],
            ),
            None,
        )
        mock_start.return_value[0].headers = {"Content-Type": "text/event-stream"}
        response = self.client.post(
            "/v1/responses",
            json={
                "model": "gpt-5.4",
                "input": "hello",
                "tools": [{"type": "web_search"}],
                "taskType": "page_assistant_answer",
                "gardenId": "physics-for-ee",
            },
        )
        self.assertEqual(response.status_code, 200)
        mock_start.assert_called_once()
        outbound = mock_start.call_args.args[0]
        self.assertNotIn("taskType", outbound)
        self.assertNotIn("gardenId", outbound)
        self.assertNotIn("councilRunId", response.get_json())

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_multimodal_input_bypasses_council(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.created", "response": {"id": "resp_img", "object": "response"}},
                    {
                        "type": "response.completed",
                        "response": {"id": "resp_img", "object": "response", "status": "completed", "output": []},
                    },
                ],
            ),
            None,
        )
        mock_start.return_value[0].headers = {"Content-Type": "text/event-stream"}
        response = self.client.post(
            "/v1/responses",
            json={
                "model": "gpt-5.4",
                "input": [
                    {
                        "type": "message",
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": "what is in this picture?"},
                            {"type": "input_image", "image_url": "data:image/png;base64,AAAA"},
                        ],
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        mock_start.assert_called_once()

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_council_false_bypasses_responses(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.created", "response": {"id": "resp_ncf", "object": "response"}},
                    {
                        "type": "response.completed",
                        "response": {"id": "resp_ncf", "object": "response", "status": "completed", "output": []},
                    },
                ],
            ),
            None,
        )
        mock_start.return_value[0].headers = {"Content-Type": "text/event-stream"}
        response = self.client.post(
            "/v1/responses",
            json={"model": "gpt-5.4", "input": "hello", "council": False},
        )
        self.assertEqual(response.status_code, 200)
        mock_start.assert_called_once()
        outbound = mock_start.call_args.args[0]
        self.assertNotIn("council", outbound)


class CouncilDebugRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_session_state()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.environ["COUNCIL_LEDGER_DIR"] = self.tmp.name
        self.addCleanup(lambda: os.environ.pop("COUNCIL_LEDGER_DIR", None))
        self.addCleanup(lambda: os.environ.pop("ENABLE_COUNCIL_DEBUG", None))
        self.addCleanup(lambda: os.environ.pop("ENABLE_COUNCIL_DEBUG_PROMPTS", None))
        self.app = create_app()
        self.client = self.app.test_client()

    def _write_run(self) -> CouncilRun:
        ledger = JsonlCouncilLedger(self.tmp.name)
        run = CouncilRun(
            id="crun_debugtest",
            user_prompt="hi",
            messages=[
                {"role": "system", "content": "HIDDEN SYSTEM PROMPT"},
                {"role": "user", "content": "hi"},
            ],
            council_mode="direct_council",
            task_type="tagging",
            garden_id="physics-for-ee",
            final_answer="answer",
        )
        ledger.record_event(run.id, "council_run_created", {"councilMode": run.council_mode})
        ledger.save_run(run)
        return run

    def test_debug_endpoints_disabled_by_default(self) -> None:
        self._write_run()
        listing = self.client.get("/debug/council-runs")
        detail = self.client.get("/debug/council-runs/crun_debugtest")
        self.assertEqual(listing.status_code, 403)
        self.assertEqual(detail.status_code, 403)

    def test_debug_returns_run_with_redacted_prompts(self) -> None:
        os.environ["ENABLE_COUNCIL_DEBUG"] = "true"
        self._write_run()
        response = self.client.get("/debug/council-runs/crun_debugtest")
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["run"]["id"], "crun_debugtest")
        system_message = body["run"]["messages"][0]
        self.assertNotIn("HIDDEN SYSTEM PROMPT", json.dumps(body))
        self.assertIn("redacted", system_message["content"])
        self.assertEqual(body["run"]["messages"][1]["content"], "hi")
        self.assertTrue(body["events"])
        self.assertEqual(body["events"][0]["type"], "council_run_created")

    def test_debug_include_prompts_requires_both_flags(self) -> None:
        os.environ["ENABLE_COUNCIL_DEBUG"] = "true"
        self._write_run()
        without_flag = self.client.get("/debug/council-runs/crun_debugtest?includePrompts=true")
        self.assertNotIn("HIDDEN SYSTEM PROMPT", without_flag.get_data(as_text=True))
        os.environ["ENABLE_COUNCIL_DEBUG_PROMPTS"] = "true"
        with_flag = self.client.get("/debug/council-runs/crun_debugtest?includePrompts=true")
        self.assertIn("HIDDEN SYSTEM PROMPT", with_flag.get_data(as_text=True))

    def test_debug_lists_recent_runs(self) -> None:
        os.environ["ENABLE_COUNCIL_DEBUG"] = "true"
        self._write_run()
        response = self.client.get("/debug/council-runs")
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        run_ids = [run["id"] for run in body["runs"]]
        self.assertIn("crun_debugtest", run_ids)
        entry = next(run for run in body["runs"] if run["id"] == "crun_debugtest")
        self.assertEqual(entry["councilMode"], "direct_council")
        self.assertEqual(entry["taskType"], "tagging")
        self.assertEqual(entry["gardenId"], "physics-for-ee")

    def test_debug_unknown_run_returns_404(self) -> None:
        os.environ["ENABLE_COUNCIL_DEBUG"] = "true"
        response = self.client.get("/debug/council-runs/crun_missing")
        self.assertEqual(response.status_code, 404)


# A phrase unique to the compact block, so a test can tell the two forms apart.
COMPACT_MARKER = "Straight quotes and apostrophes only"


class UnslopIntegrationTests(unittest.TestCase):
    """The unslop skill humanizes only the final, UI-facing prose answer, never
    intermediate council calls or structured/machine output."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = CouncilConfig(
            council_models=["gpt-test-a", "gpt-test-b", "gpt-test-c"],
            chairman_model="gpt-test-chairman",
        )
        # A self-contained fake unslop repo so the test never depends on a clone
        # being present, and a known marker to assert on.
        self.skill_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.skill_dir.cleanup)
        (Path(self.skill_dir.name) / "SKILL.md").write_text(
            "# Unslop\nUNSLOP_SKILL_MARKER: remove signs of AI writing.",
            encoding="utf-8",
        )
        refs = Path(self.skill_dir.name) / "references"
        refs.mkdir()
        (refs / "blacklist.md").write_text("BLACKLIST_MARKER", encoding="utf-8")
        self._reset_unslop_cache()
        self._env = patch.dict(
            os.environ,
            {"ENABLE_UNSLOP": "true", "UNSLOP_SKILL_DIR": self.skill_dir.name},
        )
        self._env.start()
        self.addCleanup(self._env.stop)
        self.addCleanup(self._reset_unslop_cache)

    @staticmethod
    def _reset_unslop_cache() -> None:
        from chatmock.council import unslop as unslop_module

        unslop_module.reset_directive_cache()

    def _runtime(self) -> tuple[CouncilRuntime, StubRouter]:
        router = StubRouter()
        runtime = CouncilRuntime(
            config=self.config,
            router=router,
            ledger=JsonlCouncilLedger(self.tmp.name),
        )
        return runtime, router

    def _systems(self, router: StubRouter) -> list[str]:
        return [call.system or "" for call in router.calls]

    def test_interactive_chat_answer_is_unslopped(self) -> None:
        runtime, router = self._runtime()
        runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "explain entropy"}],
                requested_model="gpt-test",
            )
        )
        # Direct council: exactly one final-answer call, and it carries the skill.
        self.assertEqual(len(router.calls), 1)
        self.assertIn("UNSLOP_SKILL_MARKER", router.calls[0].system or "")

    def test_learning_page_prose_gets_the_compact_block(self) -> None:
        """Generated page prose gets the compact rules, not the full skill.

        Measured 2026-08-14 by replaying real subsection prompts: the compact
        block scores at least as well as the ~30KB skill on this path, so the
        skill's remaining patterns were pure token cost. Interactive chat is a
        different genre and still gets the full skill - see the direct-council
        test above.
        """
        runtime, router = self._runtime()
        runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "write the section"}],
                task_type="subsection_generation",
            )
        )
        chair_systems = [s for s in self._systems(router) if "Chair Synthesizer" in s]
        self.assertTrue(chair_systems, "expected a chair synthesis call")
        self.assertTrue(all(COMPACT_MARKER in s for s in chair_systems))
        self.assertTrue(all("UNSLOP_SKILL_MARKER" not in s for s in chair_systems))
        # Candidates and critics (non-final calls) must NOT carry anything.
        non_final = [s for s in self._systems(router) if "Chair Synthesizer" not in s]
        self.assertTrue(non_final)
        self.assertTrue(all(COMPACT_MARKER not in s for s in non_final))
        self.assertTrue(all("UNSLOP_SKILL_MARKER" not in s for s in non_final))

    def test_compact_prose_can_be_switched_back_to_the_full_skill(self) -> None:
        with patch.dict(os.environ, {"UNSLOP_COMPACT_PROSE": "false"}):
            self._reset_unslop_cache()
            runtime, router = self._runtime()
            runtime.run(
                CouncilInput(
                    messages=[{"role": "user", "content": "write the section"}],
                    task_type="subsection_generation",
                )
            )
            chair_systems = [s for s in self._systems(router) if "Chair Synthesizer" in s]
            self.assertTrue(chair_systems)
            self.assertTrue(all("UNSLOP_SKILL_MARKER" in s for s in chair_systems))

    def test_the_voice_profile_rides_along_with_the_compact_block(self) -> None:
        """The Voice tab writes style-profile.md. It must survive the swap, or
        calibrating a voice would silently stop affecting learning pages."""
        refs = Path(self.skill_dir.name) / "references"
        (refs / "style-profile.md").write_text("VOICE_PROFILE_MARKER", encoding="utf-8")
        self._reset_unslop_cache()
        runtime, router = self._runtime()
        runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "write the section"}],
                task_type="subsection_generation",
            )
        )
        chair_systems = [s for s in self._systems(router) if "Chair Synthesizer" in s]
        self.assertTrue(chair_systems)
        self.assertTrue(all("VOICE_PROFILE_MARKER" in s for s in chair_systems))
        self.assertTrue(all(COMPACT_MARKER in s for s in chair_systems))

    def test_the_compact_block_keeps_the_structural_guards(self) -> None:
        """Losing these would let a rewrite touch LaTeX or a source anchor."""
        from chatmock.council.unslop import unslop_directive

        directive = unslop_directive(compact=True) or ""
        for guard in ("S1.P12.F1", "breadboard-visual", "frontmatter", "display math"):
            self.assertIn(guard, directive)
        for repair_exception in ("missing-source-formula", "VERBATIM SOURCE FORMULA COPY SHEET", "byte-for-byte"):
            self.assertIn(repair_exception, directive)
        full_directive = unslop_directive(compact=False) or ""
        for repair_exception in ("missing-source-formula", "VERBATIM SOURCE FORMULA COPY SHEET", "byte-for-byte"):
            self.assertIn(repair_exception, full_directive)
        self.assertLess(len(directive), 4000, "the compact block stopped being compact")

    def test_structured_task_type_is_never_unslopped(self) -> None:
        runtime, router = self._runtime()
        runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "build the map"}],
                task_type="source_map",
            )
        )
        self.assertTrue(router.calls)
        self.assertFalse(any("UNSLOP_SKILL_MARKER" in (c.system or "") for c in router.calls))

    def test_disabling_unslop_removes_it_from_prose(self) -> None:
        with patch.dict(os.environ, {"ENABLE_UNSLOP": "false"}):
            self._reset_unslop_cache()
            runtime, router = self._runtime()
            runtime.run(
                CouncilInput(
                    messages=[{"role": "user", "content": "hi"}],
                    requested_model="gpt-test",
                )
            )
            self.assertTrue(router.calls)
            self.assertFalse(any("UNSLOP_SKILL_MARKER" in (c.system or "") for c in router.calls))


if __name__ == "__main__":
    unittest.main()
