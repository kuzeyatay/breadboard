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
from chatmock.council.ledger import JsonlCouncilLedger
from chatmock.council.policy import CouncilConfig, choose_council_mode
from chatmock.council.runtime import CouncilRuntime
from chatmock.council.types import CouncilInput, CouncilRun
from chatmock.providers.chatgpt_upstream import ChatGptUpstreamProvider
from chatmock.providers.types import ModelCall, ProviderError
from chatmock.session import reset_session_state


class FakeUpstream:
    """Minimal stand-in for a requests streaming response (legacy passthrough)."""

    def __init__(self, events: list[dict[str, object]]) -> None:
        self._events = events
        self.status_code = 200
        self.headers: dict[str, str] = {}
        self.content = b""
        self.text = ""

    def iter_lines(self, decode_unicode: bool = False):
        for event in self._events:
            payload = f"data: {json.dumps(event)}"
            yield payload if decode_unicode else payload.encode("utf-8")

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
    ) -> None:
        self.calls: list[ModelCall] = []
        self.fail_models = set(fail_models or [])
        self.fail_messages = dict(fail_messages or {})
        self.fail_chair = fail_chair
        self.fail_reviews = fail_reviews

    def effective_model(self, model: str) -> str:
        return model

    def call_model(self, call: ModelCall) -> str:
        self.calls.append(call)
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
    @patch("chatmock.providers.chatgpt_upstream.record_rate_limits_from_response")
    @patch("chatmock.providers.chatgpt_upstream.start_upstream_request")
    def test_records_rate_limit_headers_for_council_calls(self, mock_start, mock_record) -> None:
        upstream = FakeUpstream(
            [
                {"type": "response.output_text.delta", "delta": "hello"},
                {"type": "response.completed", "response": {"id": "resp_1"}},
            ]
        )
        upstream.headers = {"x-codex-primary-used-percent": "7.5"}
        mock_start.return_value = (upstream, None)

        provider = ChatGptUpstreamProvider(reasoning_effort="low", reasoning_summary="none")
        text = provider.call_model(
            ModelCall(model="gpt-5.4", messages=[{"role": "user", "content": "hi"}])
        )

        self.assertEqual(text, "hello")
        mock_record.assert_called_once_with(upstream)


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
        runtime, _ = self._runtime()
        run = runtime.run(
            CouncilInput(messages=[{"role": "user", "content": "hi"}], requested_model="gpt-test")
        )
        base = Path(self.tmp.name)
        self.assertTrue((base / f"{run.id}.json").exists())
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

    def test_response_preserves_shape_and_adds_council_run_id(self) -> None:
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
        self.assertIn("usage", body)
        # Council extensions.
        self.assertTrue(body["councilRunId"].startswith("crun_"))
        self.assertEqual(body["councilMode"], "direct_council")
        self.assertNotIn("council", body)

    def test_streaming_response_carries_final_answer(self) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "stream": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        self.assertEqual(response.status_code, 200)
        text = response.get_data(as_text=True)
        self.assertIn("CANDIDATE ANSWER", text)
        self.assertIn("councilRunId", text)
        self.assertIn("data: [DONE]", text)

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
                },
            )
        self.assertEqual(response.status_code, 200)
        council_input = mock_ask.call_args.args[0]
        self.assertEqual(council_input.task_type, "subsection_generation")
        self.assertEqual(council_input.garden_id, "physics-for-ee")
        self.assertEqual(council_input.page_id, "standing-waves")
        self.assertEqual(council_input.source_context, source_context)

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
        text = body["output"][0]["content"][0]["text"]
        self.assertTrue(text.startswith("CANDIDATE ANSWER"))

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


if __name__ == "__main__":
    unittest.main()
