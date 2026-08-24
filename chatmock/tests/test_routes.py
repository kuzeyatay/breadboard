from __future__ import annotations

import json
import os
import socket
import threading
import time
import unittest
from unittest.mock import patch

import tempfile

from chatmock.app import create_app
from chatmock.model_identity import (
    RESOLVED_MODEL_PLACEHOLDER,
    RESOLVED_PROVIDER_PLACEHOLDER,
)
from chatmock.session import reset_session_state
from chatmock.utils import sse_translate_chat
from websockets.sync.client import connect as ws_connect

_provider_isolation: tempfile.TemporaryDirectory | None = None


def setUpModule() -> None:
    """Keep these tests off the developer's real provider settings.

    Routing now consults `providers.json` — a request with no model resolves to
    the configured background model — so without this the suite passes or fails
    depending on which model the machine running it happens to have selected.
    """
    global _provider_isolation
    _provider_isolation = tempfile.TemporaryDirectory()
    os.environ["CHATMOCK_PROVIDERS_FILE"] = os.path.join(
        _provider_isolation.name, "providers.json"
    )
    os.environ["CHATMOCK_MODEL_TELEMETRY_FILE"] = os.path.join(
        _provider_isolation.name, "model-routing.jsonl"
    )
    os.environ["CHATMOCK_FAILOVER_FILE"] = os.path.join(
        _provider_isolation.name, "failover.json"
    )
    os.environ["CHATMOCK_DEFAULT_MODEL"] = "gpt-5.6-sol"


def tearDownModule() -> None:
    os.environ.pop("CHATMOCK_PROVIDERS_FILE", None)
    os.environ.pop("CHATMOCK_MODEL_TELEMETRY_FILE", None)
    os.environ.pop("CHATMOCK_FAILOVER_FILE", None)
    os.environ.pop("CHATMOCK_DEFAULT_MODEL", None)
    if _provider_isolation is not None:
        _provider_isolation.cleanup()


class FakeUpstream:
    def __init__(
        self,
        events: list[dict[str, object]] | None = None,
        *,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
        content: bytes | None = None,
        text: str = "",
    ) -> None:
        self._events = events
        self.status_code = status_code
        self.headers = headers or {}
        self.content = content or b""
        self.text = text

    def iter_lines(self, decode_unicode: bool = False):
        for event in self._events or []:
            payload = f"data: {json.dumps(event)}"
            yield payload if decode_unicode else payload.encode("utf-8")

    def iter_content(self, chunk_size=None):
        if self.content:
            yield self.content
            return
        for event in self._events or []:
            payload = f"data: {json.dumps(event)}\n\n".encode("utf-8")
            yield payload

    def json(self):
        return json.loads(self.content.decode("utf-8"))

    def close(self) -> None:
        return None


class RouteTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_session_state()
        # These tests exercise the legacy upstream passthrough, which is still
        # used for tool-calling and council-bypassed requests. Council-mediated
        # behavior is covered by tests/test_council.py.
        os.environ["ENABLE_COUNCIL"] = "false"
        self.addCleanup(lambda: os.environ.pop("ENABLE_COUNCIL", None))
        self.app = create_app()
        self.client = self.app.test_client()

    def test_openai_models_list(self) -> None:
        response = self.client.get("/v1/models")
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        model_ids = [item["id"] for item in body["data"]]
        self.assertEqual(model_ids[0], "gpt-5.6-sol")
        self.assertIn("gpt-5.4", model_ids)
        self.assertIn("gpt-5.4-mini", model_ids)
        self.assertIn("gpt-5.3-codex-spark", model_ids)

    def test_legacy_reasoning_stream_includes_openai_compatible_field(self) -> None:
        upstream = FakeUpstream(
            [
                {"type": "response.reasoning_summary_text.delta", "delta": "Checked sources."},
                {"type": "response.output_text.delta", "delta": "Answer"},
                {"type": "response.completed", "response": {"id": "resp_reasoning"}},
            ]
        )

        translated = b"".join(
            sse_translate_chat(
                upstream,
                model="gpt-5.6-sol",
                created=1,
                reasoning_compat="legacy",
            )
        ).decode("utf-8")
        events = [
            json.loads(line[len("data: ") :])
            for line in translated.splitlines()
            if line.startswith("data: {")
        ]
        reasoning_delta = next(
            event["choices"][0]["delta"]
            for event in events
            if event.get("choices")
            and event["choices"][0]["delta"].get("reasoning_content")
        )
        self.assertEqual(reasoning_delta["reasoning_content"], "Checked sources.")
        self.assertEqual(reasoning_delta["reasoning_summary"], "Checked sources.")

    def test_legacy_stream_keeps_native_web_search_internal(self) -> None:
        upstream = FakeUpstream(
            [
                {
                    "type": "response.web_search_call.in_progress",
                    "item_id": "ws_1",
                },
                {
                    "type": "response.web_search_call.searching",
                    "item_id": "ws_1",
                },
                {
                    "type": "response.web_search_call.completed",
                    "item_id": "ws_1",
                },
                {
                    "type": "response.output_item.done",
                    "item": {"type": "web_search_call", "id": "ws_1", "status": "completed"},
                },
                {"type": "response.output_text.delta", "delta": "Grounded answer"},
                {"type": "response.completed", "response": {"id": "resp_search"}},
            ]
        )

        translated = b"".join(
            sse_translate_chat(upstream, model="gpt-5.6-sol", created=1)
        ).decode("utf-8")
        events = [
            json.loads(line[len("data: ") :])
            for line in translated.splitlines()
            if line.startswith("data: {")
        ]
        deltas = [event["choices"][0]["delta"] for event in events if event.get("choices")]
        finish_reasons = [
            event["choices"][0]["finish_reason"]
            for event in events
            if event.get("choices") and event["choices"][0].get("finish_reason")
        ]

        self.assertFalse(any("tool_calls" in delta for delta in deltas))
        self.assertEqual(
            "".join(delta.get("content", "") for delta in deltas),
            "Grounded answer",
        )
        self.assertEqual(finish_reasons, ["stop"])

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_does_not_duplicate_function_web_search(self, mock_start) -> None:
        app = create_app(default_web_search=True)
        client = app.test_client()
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp_search_tool"}},
                ]
            ),
            None,
        )

        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "research this"}],
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "web_search",
                            "description": "Search the web",
                            "parameters": {"type": "object", "properties": {}},
                        },
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        outbound_tools = mock_start.call_args.kwargs["tools"]
        self.assertEqual(
            [(tool.get("type"), tool.get("name")) for tool in outbound_tools],
            [("function", "web_search")],
        )

    def test_ollama_tags_list(self) -> None:
        response = self.client.get("/api/tags")
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        model_names = [item["name"] for item in body["models"]]
        self.assertEqual(model_names[0], "gpt-5.6-sol")
        self.assertIn("gpt-5.4", model_names)
        self.assertIn("gpt-5.4-mini", model_names)

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_defaults_to_gpt_5_6_sol(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp-default"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_start.call_args.args[0], "gpt-5.6-sol")
        self.assertEqual(response.get_json()["model"], "gpt-5.6-sol")

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_resolves_hermes_model_identity(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp-identity"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "default",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            f"Model: {RESOLVED_MODEL_PLACEHOLDER}\n"
                            f"Provider: {RESOLVED_PROVIDER_PLACEHOLDER}"
                        ),
                    },
                    {"role": "user", "content": "what model are you?"},
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        dispatched_input = json.dumps(mock_start.call_args.args[1])
        self.assertIn("Model: gpt-5.6-sol", dispatched_input)
        self.assertIn("Provider: chatgpt", dispatched_input)
        self.assertNotIn(RESOLVED_MODEL_PLACEHOLDER, dispatched_input)
        self.assertNotIn(RESOLVED_PROVIDER_PLACEHOLDER, dispatched_input)

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp-openai"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={"model": "gpt5.4-mini", "messages": [{"role": "user", "content": "hi"}]},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["choices"][0]["message"]["content"], "hello")
        self.assertEqual(body["model"], "gpt5.4-mini")

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_reports_the_upstream_refusal_verbatim(self, mock_start) -> None:
        # The regression: the ChatGPT backend refuses a model with a `detail`
        # body, not an `error.message` one, so every refusal reached the caller
        # as the unactionable words "Upstream error".
        detail = "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account."
        mock_start.return_value = (
            FakeUpstream(
                status_code=400,
                content=json.dumps({"detail": detail}).encode("utf-8"),
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={"model": "gpt-5.6-sol", "messages": [{"role": "user", "content": "hi"}]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"]["message"], detail)

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_falls_back_when_the_body_says_nothing(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(status_code=500, content=b"{}", text=""),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={"model": "gpt-5.6-sol", "messages": [{"role": "user", "content": "hi"}]},
        )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json()["error"]["message"], "Upstream error")

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_responses_tools_do_not_replay_an_unqualified_502(self, mock_start) -> None:
        failed = FakeUpstream(status_code=502, content=b"{}", text="")
        mock_start.side_effect = [
            (failed, None),
            (
                FakeUpstream(
                    [{"type": "response.completed", "response": {"id": "late"}}]
                ),
                None,
            ),
        ]

        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "messages": [{"role": "user", "content": "research this"}],
                "responses_tools": [{"type": "web_search"}],
            },
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(mock_start.call_count, 1)

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_responses_tools_repair_explicit_validation_rejection(self, mock_start) -> None:
        mock_start.side_effect = [
            (
                FakeUpstream(
                    status_code=400,
                    content=b'{"error":{"message":"unsupported tool"}}',
                ),
                None,
            ),
            (
                FakeUpstream(
                    [
                        {"type": "response.output_text.delta", "delta": "answer"},
                        {"type": "response.completed", "response": {"id": "repaired"}},
                    ]
                ),
                None,
            ),
        ]

        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "messages": [{"role": "user", "content": "research this"}],
                "responses_tools": [{"type": "web_search"}],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["choices"][0]["message"]["content"], "answer")
        self.assertEqual(mock_start.call_count, 2)

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_learn_strict_raw_request_never_retries_tools_or_leaks_flag(self, mock_start) -> None:
        mock_start.side_effect = [
            (
                FakeUpstream(
                    status_code=400,
                    content=b'{"error":{"message":"unsupported tool"}}',
                ),
                None,
            ),
            (FakeUpstream([{"type": "response.completed"}]), None),
        ]
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "messages": [{"role": "user", "content": "research this"}],
                "responses_tools": [{"type": "web_search"}],
                "learnStrictRoute": True,
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(mock_start.call_count, 1)
        self.assertIs(mock_start.call_args.kwargs["strict_single_attempt"], True)
        self.assertNotIn("learnStrictRoute", json.dumps(mock_start.call_args))

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_learn_strict_alias_conflict_fails_before_raw_dispatch(self, mock_start) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "messages": [{"role": "user", "content": "hi"}],
                "tools": [{"type": "function", "function": {"name": "noop"}}],
                "learnStrictRoute": True,
                "learn_strict_route": False,
            },
        )
        self.assertEqual(response.status_code, 400)
        mock_start.assert_not_called()

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_learn_strict_rejects_non_direct_council_mode_before_dispatch(self, mock_start) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "messages": [{"role": "user", "content": "hi"}],
                "tools": [{"type": "function", "function": {"name": "noop"}}],
                "learnStrictRoute": True,
                "councilModeOverride": "full_council",
            },
        )
        self.assertEqual(response.status_code, 409, response.get_json())
        mock_start.assert_not_called()

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_learn_strict_ignores_debug_model_substitution(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "answer"},
                    {"type": "response.completed", "response": {"id": "strict-debug"}},
                ]
            ),
            None,
        )
        client = create_app(debug_model="gpt-5.4").test_client()
        response = client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "messages": [{"role": "user", "content": "hi"}],
                "tools": [{"type": "function", "function": {"name": "noop"}}],
                "learnStrictRoute": True,
            },
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(mock_start.call_count, 1)
        self.assertEqual(mock_start.call_args.args[0], "gpt-5.6-sol")
        self.assertIs(mock_start.call_args.kwargs["strict_single_attempt"], True)

    @patch("chatmock.routes_openai.provider_dispatch.chat_completion_response")
    @patch("chatmock.routes_openai.start_upstream_request")
    def test_learn_strict_unknown_external_image_route_never_dispatches(
        self,
        mock_start,
        external_dispatch,
    ) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "missing-provider/model",
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Describe it"},
                        {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
                    ],
                }],
                "learnStrictRoute": True,
            },
        )
        self.assertEqual(response.status_code, 409, response.get_json())
        mock_start.assert_not_called()
        external_dispatch.assert_not_called()

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_learn_strict_image_request_keeps_one_raw_route(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "described"},
                    {"type": "response.completed", "response": {"id": "resp-image"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Describe it"},
                        {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
                    ],
                }],
                "learnStrictRoute": True,
            },
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(mock_start.call_count, 1)
        self.assertIs(mock_start.call_args.kwargs["strict_single_attempt"], True)

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_responses_tools_preserve_ambiguous_repair_transport_failure(
        self,
        mock_start,
    ) -> None:
        first = FakeUpstream(
            status_code=400,
            content=b'{"error":{"message":"unsupported tool"}}',
        )

        def start(*_args, **_kwargs):
            if mock_start.call_count == 1:
                return first, None
            return None, self.app.response_class(
                response=json.dumps(
                    {"error": {"message": "ambiguous repaired POST"}}
                ),
                status=502,
                mimetype="application/json",
            )

        mock_start.side_effect = start
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "messages": [{"role": "user", "content": "research this"}],
                "responses_tools": [{"type": "web_search"}],
            },
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.get_json()["error"]["message"],
            "ambiguous repaired POST",
        )
        self.assertEqual(mock_start.call_count, 2)

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_normalizes_forced_tool_choice(self, mock_start) -> None:
        # Chat clients force a function with a nested {"function": {"name": ...}}
        # object; the Responses API needs the name at the top level or upstream
        # rejects the call with "Missing required parameter: 'tool_choice.name'".
        mock_start.return_value = (
            FakeUpstream([{"type": "response.completed", "response": {"id": "resp-tool"}}]),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "tools": [
                    {
                        "type": "function",
                        "function": {"name": "json", "parameters": {"type": "object", "properties": {}}},
                    }
                ],
                "tool_choice": {"type": "function", "function": {"name": "json"}},
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_start.call_args.kwargs["tool_choice"], {"type": "function", "name": "json"})

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_honors_debug_model_override(self, mock_start) -> None:
        app = create_app(debug_model="gpt-5.4")
        client = app.test_client()
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp-openai"}},
                ]
            ),
            None,
        )
        response = client.post(
            "/v1/chat/completions",
            json={"model": "gpt-5.3-codex", "messages": [{"role": "user", "content": "hi"}]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_start.call_args.args[0], "gpt-5.4")

    @patch("chatmock.routes_ollama.start_upstream_request")
    def test_ollama_chat(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed"},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/api/chat",
            json={"model": "gpt-5.4", "messages": [{"role": "user", "content": "hi"}], "stream": False},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["message"]["content"], "hello")
        self.assertEqual(body["model"], "gpt-5.4")

    @patch("chatmock.routes_ollama.start_upstream_request")
    def test_ollama_responses_tools_do_not_replay_an_unqualified_502(
        self,
        mock_start,
    ) -> None:
        failed = FakeUpstream(status_code=502, content=b"{}", text="")
        mock_start.side_effect = [
            (failed, None),
            (FakeUpstream([{"type": "response.completed"}]), None),
        ]

        response = self.client.post(
            "/api/chat",
            json={
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": "research this"}],
                "stream": False,
                "responses_tools": [{"type": "web_search"}],
            },
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(mock_start.call_count, 1)

    @patch("chatmock.routes_ollama.start_upstream_request")
    def test_ollama_responses_tools_preserve_ambiguous_repair_transport_failure(
        self,
        mock_start,
    ) -> None:
        first = FakeUpstream(
            status_code=422,
            content=b'{"error":{"message":"unsupported tool"}}',
        )

        def start(*_args, **_kwargs):
            if mock_start.call_count == 1:
                return first, None
            return None, self.app.response_class(
                response=json.dumps(
                    {"error": {"message": "ambiguous repaired POST"}}
                ),
                status=502,
                mimetype="application/json",
            )

        mock_start.side_effect = start
        response = self.client.post(
            "/api/chat",
            json={
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": "research this"}],
                "stream": False,
                "responses_tools": [{"type": "web_search"}],
            },
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.get_json()["error"]["message"],
            "ambiguous repaired POST",
        )
        self.assertEqual(mock_start.call_count, 2)

    @patch("chatmock.routes_ollama.start_upstream_request")
    def test_ollama_chat_honors_debug_model_override(self, mock_start) -> None:
        app = create_app(debug_model="gpt-5.4")
        client = app.test_client()
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed"},
                ]
            ),
            None,
        )
        response = client.post(
            "/api/chat",
            json={"model": "gpt-5.3-codex", "messages": [{"role": "user", "content": "hi"}], "stream": False},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_start.call_args.args[0], "gpt-5.4")
        self.assertEqual(body["model"], "gpt-5.4")

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_fast_mode_sets_priority_service_tier(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp-openai"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "fast_mode": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_start.call_args.kwargs["service_tier"], "priority")

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_fast_mode_false_overrides_server_default(self, mock_start) -> None:
        app = create_app(fast_mode=True)
        client = app.test_client()
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp-openai"}},
                ]
            ),
            None,
        )
        response = client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.4",
                "fast_mode": False,
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(mock_start.call_args.kwargs["service_tier"])

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_rejects_unsupported_explicit_fast_mode(self, mock_start) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.3-codex",
                "fast_mode": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 400)
        self.assertIn("Fast mode is not supported", body["error"]["message"])
        mock_start.assert_not_called()

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_honors_top_level_reasoning_effort(self, mock_start) -> None:
        """`reasoning_effort` is the field an OpenAI SDK client sends.

        Hermes puts every Terminal/Garden turn through it, so while only the
        Responses-shaped `reasoning` object was read here, the intelligence mode
        chosen in the UI never reached a ChatGPT model — each turn silently ran
        at the server default.
        """
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp-effort"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "reasoning_effort": "xhigh",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_start.call_args.kwargs["reasoning_param"]["effort"], "xhigh")

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_reasoning_object_outranks_top_level_effort(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp-effort-order"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "reasoning": {"effort": "max"},
                "reasoning_effort": "low",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_start.call_args.kwargs["reasoning_param"]["effort"], "max")

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_chat_completions_drops_effort_the_model_does_not_honour(self, mock_start) -> None:
        # gpt-5.1 stops at high. Sending `max` must leave the server default in
        # place rather than forward a level the upstream would reject.
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp-effort-clamp"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.1",
                "reasoning_effort": "max",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_start.call_args.kwargs["reasoning_param"]["effort"], "medium")

    @patch("chatmock.routes_openai.start_upstream_request")
    def test_completions_honors_top_level_reasoning_effort(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp-effort-legacy"}},
                ]
            ),
            None,
        )
        response = self.client.post(
            "/v1/completions",
            json={"model": "gpt-5.6-sol", "prompt": "hi", "reasoning_effort": "high"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_start.call_args.kwargs["reasoning_param"]["effort"], "high")

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_responses_route_honors_top_level_reasoning_effort(self, mock_start) -> None:
        # The Responses API has no `reasoning_effort` field, so a chat-shaped
        # client's value is folded into `reasoning` and must not be forwarded.
        mock_start.return_value = (
            FakeUpstream(
                [
                    {
                        "type": "response.created",
                        "response": {"id": "resp_effort", "object": "response", "status": "in_progress"},
                    },
                    {
                        "type": "response.completed",
                        "response": {
                            "id": "resp_effort",
                            "object": "response",
                            "status": "completed",
                            "output": [],
                        },
                    },
                ],
                headers={"Content-Type": "text/event-stream"},
            ),
            None,
        )
        response = self.client.post(
            "/v1/responses",
            json={"model": "gpt-5.6-sol", "input": "hello", "reasoning_effort": "xhigh"},
        )
        self.assertEqual(response.status_code, 200)
        outbound_payload = mock_start.call_args.args[0]
        self.assertEqual(outbound_payload["reasoning"]["effort"], "xhigh")
        self.assertNotIn("reasoning_effort", outbound_payload)

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_responses_route_returns_completed_response_object(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {
                        "type": "response.created",
                        "response": {"id": "resp_123", "object": "response", "status": "in_progress"},
                    },
                    {
                        "type": "response.completed",
                        "response": {
                            "id": "resp_123",
                            "object": "response",
                            "status": "completed",
                            "output": [],
                        },
                    },
                ],
                headers={"Content-Type": "text/event-stream"},
            ),
            None,
        )
        response = self.client.post(
            "/v1/responses",
            json={"model": "gpt5.4-mini", "input": "hello"},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["id"], "resp_123")
        outbound_payload = mock_start.call_args.args[0]
        self.assertEqual(outbound_payload["model"], "gpt-5.4-mini")
        self.assertEqual(outbound_payload["store"], False)
        self.assertEqual(
            outbound_payload["input"],
            [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]}],
        )
        self.assertEqual(outbound_payload["reasoning"]["effort"], "medium")
        self.assertIsInstance(outbound_payload["prompt_cache_key"], str)

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_responses_default_is_resolved_before_dispatch_and_telemetry(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {
                        "type": "response.completed",
                        "response": {
                            "id": "resp_default",
                            "object": "response",
                            "status": "completed",
                            "output": [],
                        },
                    }
                ],
                headers={"Content-Type": "text/event-stream"},
            ),
            None,
        )

        response = self.client.post(
            "/v1/responses",
            json={"model": "default", "input": "hello"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_start.call_args.args[0]["model"], "gpt-5.6-sol")
        with open(os.environ["CHATMOCK_MODEL_TELEMETRY_FILE"], encoding="utf-8") as handle:
            attempts = [json.loads(line) for line in handle if line.strip()]
        self.assertEqual(attempts[-1]["requestedModel"], "default")
        self.assertEqual(attempts[-1]["resolvedModel"], "gpt-5.6-sol")
        self.assertEqual(attempts[-1]["upstreamModel"], "gpt-5.6-sol")
        self.assertEqual(attempts[-1]["outcome"], "dispatched")

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_responses_route_honors_debug_model_override(self, mock_start) -> None:
        app = create_app(debug_model="gpt-5.4")
        client = app.test_client()
        mock_start.return_value = (
            FakeUpstream(
                [
                    {
                        "type": "response.created",
                        "response": {"id": "resp_debug", "object": "response", "status": "in_progress"},
                    },
                    {
                        "type": "response.completed",
                        "response": {
                            "id": "resp_debug",
                            "object": "response",
                            "status": "completed",
                            "output": [],
                        },
                    },
                ],
                headers={"Content-Type": "text/event-stream"},
            ),
            None,
        )
        response = client.post(
            "/v1/responses",
            json={"model": "gpt-5.3-codex", "input": "hello"},
        )
        self.assertEqual(response.status_code, 200)
        outbound_payload = mock_start.call_args.args[0]
        self.assertEqual(outbound_payload["model"], "gpt-5.4")

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_responses_route_strips_unsupported_max_output_tokens(self, mock_start) -> None:
        mock_start.return_value = (
            FakeUpstream(
                [
                    {
                        "type": "response.created",
                        "response": {"id": "resp_limit", "object": "response", "status": "in_progress"},
                    },
                    {
                        "type": "response.completed",
                        "response": {
                            "id": "resp_limit",
                            "object": "response",
                            "status": "completed",
                            "output": [],
                        },
                    },
                ],
                headers={"Content-Type": "text/event-stream"},
            ),
            None,
        )
        response = self.client.post(
            "/v1/responses",
            json={"model": "gpt-5.4", "input": "hello", "max_output_tokens": 20},
        )
        self.assertEqual(response.status_code, 200)
        outbound_payload = mock_start.call_args.args[0]
        self.assertNotIn("max_output_tokens", outbound_payload)

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_responses_route_does_not_use_previous_response_id_for_http_follow_up(self, mock_start) -> None:
        mock_start.side_effect = [
            (
                FakeUpstream(
                    [
                        {
                            "type": "response.created",
                            "response": {"id": "resp_1", "object": "response", "status": "in_progress"},
                        },
                        {
                            "type": "response.output_item.done",
                            "item": {
                                "type": "message",
                                "role": "assistant",
                                "id": "msg_1",
                                "content": [{"type": "output_text", "text": "assistant output"}],
                            },
                        },
                        {
                            "type": "response.completed",
                            "response": {"id": "resp_1", "object": "response", "status": "completed", "output": []},
                        },
                    ],
                    headers={"Content-Type": "text/event-stream"},
                ),
                None,
            ),
            (
                FakeUpstream(
                    [
                        {
                            "type": "response.created",
                            "response": {"id": "resp_2", "object": "response", "status": "in_progress"},
                        },
                        {
                            "type": "response.completed",
                            "response": {"id": "resp_2", "object": "response", "status": "completed", "output": []},
                        },
                    ],
                    headers={"Content-Type": "text/event-stream"},
                ),
                None,
            ),
        ]

        first = self.client.post("/v1/responses", json={"model": "gpt-5.4", "input": "hello"})
        second = self.client.post(
            "/v1/responses",
            json={
                "model": "gpt-5.4",
                "input": [
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]},
                    {"type": "message", "role": "assistant", "id": "msg_1", "content": [{"type": "output_text", "text": "assistant output"}]},
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "second"}]},
                ],
            },
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        outbound_payload = mock_start.call_args_list[1].args[0]
        self.assertNotIn("previous_response_id", outbound_payload)
        self.assertEqual(
            outbound_payload["input"],
            [
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]},
                {"type": "message", "role": "assistant", "id": "msg_1", "content": [{"type": "output_text", "text": "assistant output"}]},
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "second"}]},
            ],
        )

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_responses_route_falls_back_to_full_create_when_non_input_fields_change(self, mock_start) -> None:
        mock_start.side_effect = [
            (
                FakeUpstream(
                    [
                        {
                            "type": "response.created",
                            "response": {"id": "resp_1", "object": "response", "status": "in_progress"},
                        },
                        {
                            "type": "response.completed",
                            "response": {"id": "resp_1", "object": "response", "status": "completed", "output": []},
                        },
                    ],
                    headers={"Content-Type": "text/event-stream"},
                ),
                None,
            ),
            (
                FakeUpstream(
                    [
                        {
                            "type": "response.created",
                            "response": {"id": "resp_2", "object": "response", "status": "in_progress"},
                        },
                        {
                            "type": "response.completed",
                            "response": {"id": "resp_2", "object": "response", "status": "completed", "output": []},
                        },
                    ],
                    headers={"Content-Type": "text/event-stream"},
                ),
                None,
            ),
        ]

        headers = {"X-Session-Id": "session-fixed"}
        first = self.client.post("/v1/responses", json={"model": "gpt-5.4", "input": "hello"}, headers=headers)
        second = self.client.post(
            "/v1/responses",
            json={
                "model": "gpt-5.4",
                "instructions": "changed",
                "input": [
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]},
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "second"}]},
                ],
            },
            headers=headers,
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        outbound_payload = mock_start.call_args_list[1].args[0]
        self.assertNotIn("previous_response_id", outbound_payload)
        self.assertEqual(
            outbound_payload["input"],
            [
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]},
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "second"}]},
            ],
        )

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_responses_route_clears_reuse_state_after_error(self, mock_start) -> None:
        mock_start.side_effect = [
            (
                FakeUpstream(
                    [
                        {"type": "response.created", "response": {"id": "resp_1"}},
                        {"type": "response.completed", "response": {"id": "resp_1", "output": []}},
                    ],
                    headers={"Content-Type": "text/event-stream"},
                ),
                None,
            ),
            (
                FakeUpstream(
                    [
                        {"type": "response.failed", "response": {"error": {"message": "boom"}}},
                    ],
                    headers={"Content-Type": "text/event-stream"},
                ),
                None,
            ),
            (
                FakeUpstream(
                    [
                        {"type": "response.created", "response": {"id": "resp_3"}},
                        {"type": "response.completed", "response": {"id": "resp_3", "output": []}},
                    ],
                    headers={"Content-Type": "text/event-stream"},
                ),
                None,
            ),
        ]

        headers = {"X-Session-Id": "session-fixed"}
        first = self.client.post("/v1/responses", json={"model": "gpt-5.4", "input": "hello"}, headers=headers)
        second = self.client.post(
            "/v1/responses",
            json={
                "model": "gpt-5.4",
                "input": [
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]},
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "second"}]},
                ],
            },
            headers=headers,
        )
        third = self.client.post(
            "/v1/responses",
            json={
                "model": "gpt-5.4",
                "input": [
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]},
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "second"}]},
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "third"}]},
                ],
            },
            headers=headers,
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 502)
        self.assertEqual(third.status_code, 200)
        outbound_payload = mock_start.call_args_list[2].args[0]
        self.assertNotIn("previous_response_id", outbound_payload)
        self.assertEqual(
            outbound_payload["input"],
            [
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]},
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "second"}]},
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "third"}]},
            ],
        )

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_responses_route_stream_passthrough(self, mock_start) -> None:
        chunk = b'data: {"type":"response.output_text.delta","delta":"hello"}\n\n'
        mock_start.return_value = (
            FakeUpstream(
                headers={"Content-Type": "text/event-stream"},
                content=chunk,
            ),
            None,
        )
        response = self.client.post(
            "/v1/responses",
            json={"model": "gpt-5.4", "input": "hello", "stream": True},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("response.output_text.delta", response.get_data(as_text=True))

    @patch("chatmock.routes_openai.start_upstream_raw_request")
    def test_responses_route_rejects_unsupported_explicit_priority(self, mock_start) -> None:
        response = self.client.post(
            "/v1/responses",
            json={"model": "gpt-5.3-codex", "input": "hello", "service_tier": "priority"},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 400)
        self.assertIn("Fast mode is not supported", body["error"]["message"])
        mock_start.assert_not_called()

    @patch("chatmock.websocket_routes.get_effective_chatgpt_auth", return_value=("token", "acct"))
    @patch("chatmock.websocket_routes.connect_upstream_websocket")
    def test_responses_websocket_rewrites_response_create(self, mock_connect, _mock_auth) -> None:
        class FakeUpstreamWebsocket:
            def __init__(self) -> None:
                self.sent: list[str] = []
                self._messages = [
                    json.dumps({"type": "response.created", "response": {"id": "resp_ws_1"}}),
                    json.dumps({
                        "type": "response.output_item.done",
                        "item": {
                            "type": "message",
                            "role": "assistant",
                            "id": "msg_1",
                            "content": [{"type": "output_text", "text": "assistant output"}],
                        },
                    }),
                    json.dumps({"type": "response.completed", "response": {"id": "resp_ws_1"}}),
                    json.dumps({"type": "response.created", "response": {"id": "resp_ws_2"}}),
                    json.dumps({
                        "type": "response.incomplete",
                        "response": {
                            "id": "resp_ws_2",
                            "incomplete_details": {"reason": "max_output_tokens"},
                        },
                    }),
                    json.dumps({"type": "response.created", "response": {"id": "resp_ws_3"}}),
                    json.dumps({"type": "response.completed", "response": {"id": "resp_ws_3"}}),
                ]

            def send(self, message: str) -> None:
                self.sent.append(message)

            def recv(self) -> str:
                return self._messages.pop(0)

            def close(self) -> None:
                return None

        fake_upstream = FakeUpstreamWebsocket()
        mock_connect.return_value = fake_upstream

        app = create_app()

        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        host, port = sock.getsockname()
        sock.close()

        server_thread = threading.Thread(
            target=app.run,
            kwargs={
                "host": host,
                "port": port,
                "use_reloader": False,
                "threaded": True,
            },
            daemon=True,
        )
        server_thread.start()
        time.sleep(0.5)

        with ws_connect(f"ws://{host}:{port}/v1/responses") as client:
            client.send(json.dumps({"type": "response.create", "model": "gpt-5.4", "input": "hello", "fast_mode": True}))
            first = json.loads(client.recv())
            assistant = json.loads(client.recv())
            second = json.loads(client.recv())
            client.send(
                json.dumps(
                    {
                        "type": "response.create",
                        "model": "gpt-5.4",
                        "fast_mode": True,
                        "input": [
                            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]},
                            {"type": "message", "role": "assistant", "id": "msg_1", "content": [{"type": "output_text", "text": "assistant output"}]},
                            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "second"}]},
                        ],
                    }
                )
            )
            third = json.loads(client.recv())
            fourth = json.loads(client.recv())
            client.send(
                json.dumps(
                    {
                        "type": "response.create",
                        "model": "gpt-5.4",
                        "input": "fresh after incomplete",
                    }
                )
            )
            fifth = json.loads(client.recv())
            sixth = json.loads(client.recv())

        self.assertEqual(first["type"], "response.created")
        self.assertEqual(assistant["type"], "response.output_item.done")
        self.assertEqual(second["type"], "response.completed")
        self.assertEqual(third["type"], "response.created")
        self.assertEqual(fourth["type"], "response.incomplete")
        self.assertEqual(fifth["type"], "response.created")
        self.assertEqual(sixth["type"], "response.completed")
        outbound = json.loads(fake_upstream.sent[0])
        self.assertEqual(outbound["model"], "gpt-5.4")
        self.assertEqual(outbound["service_tier"], "priority")
        self.assertEqual(outbound["type"], "response.create")
        self.assertEqual(
            outbound["input"],
            [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]}],
        )
        self.assertIn("prompt_cache_key", outbound)
        follow_up = json.loads(fake_upstream.sent[1])
        self.assertEqual(follow_up["previous_response_id"], "resp_ws_1")
        self.assertEqual(
            follow_up["input"],
            [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "second"}]}],
        )
        after_incomplete = json.loads(fake_upstream.sent[2])
        self.assertNotIn("previous_response_id", after_incomplete)
        self.assertEqual(
            after_incomplete["input"],
            [{
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "fresh after incomplete"}],
            }],
        )

    @patch("chatmock.websocket_routes.get_effective_chatgpt_auth", return_value=("token", "acct"))
    @patch("chatmock.websocket_routes.connect_upstream_websocket")
    def test_responses_websocket_rejects_recoverable_bindings_before_auth_or_connect(
        self,
        mock_connect,
        mock_auth,
    ) -> None:
        app = create_app()
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        host, port = sock.getsockname()
        sock.close()
        server_thread = threading.Thread(
            target=app.run,
            kwargs={
                "host": host,
                "port": port,
                "use_reloader": False,
                "threaded": True,
            },
            daemon=True,
        )
        server_thread.start()
        time.sleep(0.5)

        cases = (
            ({
                "clientRequestId": "lrq_fixture_ws_camel_0001",
                "clientRequestHash": "a" * 64,
            }, 409),
            ({
                "client_request_id": "lrq_fixture_ws_snake_0001",
                "client_request_hash": "a" * 64,
            }, 409),
            ({"clientRequestId": "lrq_fixture_ws_partial_0001"}, 400),
            ({
                "clientRequestId": "invalid",
                "clientRequestHash": "not-a-hash",
            }, 400),
            ({
                "clientRequestId": "lrq_fixture_ws_conflict_0001",
                "client_request_id": "lrq_fixture_ws_conflict_other",
                "clientRequestHash": "a" * 64,
            }, 400),
            ({
                "clientRequestId": "lrq_fixture_ws_hash_conflict_0001",
                "clientRequestHash": "a" * 64,
                "client_request_hash": "b" * 64,
            }, 400),
            ({"learnStrictRoute": True}, 409),
            ({"learn_strict_route": False}, 409),
            ({
                "learnStrictRoute": True,
                "learn_strict_route": False,
            }, 400),
        )
        for binding, expected_status in cases:
            with self.subTest(binding=tuple(binding), status=expected_status):
                payload = {
                    "type": "response.create",
                    "model": "gpt-5.4",
                    "input": "fixture",
                    **binding,
                }
                with ws_connect(f"ws://{host}:{port}/v1/responses") as client:
                    client.send(json.dumps(payload))
                    error = json.loads(client.recv())
                self.assertEqual(error["type"], "error")
                self.assertEqual(error["status_code"], expected_status)

        mock_auth.assert_not_called()
        mock_connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
