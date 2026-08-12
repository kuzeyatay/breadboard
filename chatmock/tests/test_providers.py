from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from chatmock import failover
from chatmock.app import create_app
from chatmock.council.policy import CouncilConfig
from chatmock.model_identity import (
    RESOLVED_MODEL_PLACEHOLDER,
    RESOLVED_PROVIDER_PLACEHOLDER,
)
from chatmock.providers import (
    anthropic,
    claude_code,
    dispatch,
    openai_compatible,
    store,
    transport,
)
from chatmock.providers.registry import (
    default_model,
    external_model_ids,
    model_entries,
    reasoning_efforts_for,
    resolve_model,
)
from chatmock.providers.router import ProviderRouter
from chatmock.providers.store import ResolvedCredentials
from chatmock.providers.types import ModelCall, ProviderError


class FakeResponse:
    """Minimal stand-in for ``requests.Response``."""

    def __init__(
        self,
        *,
        status_code: int = 200,
        body: dict | None = None,
        lines: list[str] | None = None,
    ) -> None:
        self.status_code = status_code
        self._body = body
        self._lines = lines or []
        self.closed = False

    def json(self):
        if self._body is None:
            raise ValueError("no json body")
        return self._body

    def iter_lines(self, decode_unicode: bool = False):
        for line in self._lines:
            yield line if decode_unicode else line.encode("utf-8")

    def close(self) -> None:
        self.closed = True


class ProviderTransportTests(unittest.TestCase):
    def test_quota_response_is_returned_without_retrying_the_same_model(self) -> None:
        response = FakeResponse(
            status_code=429,
            body={"error": {"message": "Resource has been exhausted"}},
        )
        with (
            patch.dict(
                os.environ,
                {
                    "CHATMOCK_PROVIDER_MAX_ATTEMPTS": "3",
                    "CHATMOCK_PROVIDER_RETRY_BACKOFF_SECONDS": "0",
                },
                clear=False,
            ),
            patch.object(transport.requests, "post", return_value=response) as post,
        ):
            result = transport.post_with_retry(
                "http://127.0.0.1:8317/v1/chat/completions",
                headers={"Content-Type": "application/json"},
                payload={"model": "gemini-test"},
                stream=True,
                provider_id="cliproxy",
            )

        self.assertIs(result, response)
        self.assertEqual(post.call_count, 1)


class ProviderStoreTests(unittest.TestCase):
    """Credential persistence, redaction and env fallbacks."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.settings_file = os.path.join(self.tmp.name, "providers.json")
        patcher = patch.dict(
            os.environ,
            {"CHATMOCK_PROVIDERS_FILE": self.settings_file},
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        # Env keys from the developer's real shell must not leak into assertions.
        for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
            os.environ.pop(name, None)

    def test_missing_file_yields_empty_settings(self) -> None:
        settings = store.read_settings()
        self.assertEqual(settings.providers, {})
        self.assertIsNone(settings.default_model)

    def test_upsert_round_trips_and_marks_configured(self) -> None:
        record = store.upsert_provider("anthropic", api_key="sk-ant-secret-value")
        self.assertIsNotNone(record)

        spec = _spec("anthropic")
        self.assertTrue(store.is_configured(spec))
        credentials = store.resolve_credentials(spec)
        self.assertTrue(credentials.usable)
        self.assertEqual(credentials.api_key, "sk-ant-secret-value")
        self.assertEqual(credentials.base_url, "https://api.anthropic.com")

    def test_public_state_never_exposes_the_key(self) -> None:
        store.upsert_provider("anthropic", api_key="sk-ant-secret-value")
        serialized = json.dumps(store.public_state())
        self.assertNotIn("sk-ant-secret-value", serialized)

        entry = _entry("anthropic")
        self.assertTrue(entry["hasStoredKey"])
        self.assertTrue(entry["configured"])
        self.assertEqual(entry["apiKeyHint"], "sk-a…alue")

    def test_disabled_provider_is_not_usable(self) -> None:
        store.upsert_provider("anthropic", api_key="sk-ant-key", enabled=False)
        credentials = store.resolve_credentials(_spec("anthropic"))
        self.assertFalse(credentials.usable)
        self.assertIn("turned off", credentials.reason or "")

    def test_environment_keys_are_ignored_by_default(self) -> None:
        """A stray ANTHROPIC_API_KEY / OPENAI_API_KEY — often ChatMock's own
        `local` placeholder rather than a real credential — must not mark a
        pay-per-token provider configured and fill the picker with ids that
        answer 401."""
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-from-env"}, clear=False):
            self.assertFalse(store.is_configured(_spec("anthropic")))
            entry = _entry("anthropic")
            self.assertFalse(entry["keyFromEnvironment"])
            self.assertFalse(entry["hasStoredKey"])
            self.assertIsNone(entry["apiKeyHint"])

    def test_environment_key_is_a_fallback_when_opted_in(self) -> None:
        # Headless/CI deployments that really do supply keys this way opt in.
        with patch.dict(
            os.environ,
            {"ANTHROPIC_API_KEY": "sk-from-env", "CHATMOCK_ALLOW_ENV_PROVIDER_KEYS": "1"},
            clear=False,
        ):
            self.assertTrue(store.is_configured(_spec("anthropic")))
            entry = _entry("anthropic")
            self.assertTrue(entry["keyFromEnvironment"])
            self.assertFalse(entry["hasStoredKey"])

    def test_keyless_providers_still_read_their_environment(self) -> None:
        # CLIPROXY_API_KEY is loopback wiring, not a purchased credential, so the
        # opt-in above must not disable the subscription proxy.
        with patch.dict(os.environ, {"CLIPROXY_API_KEY": "loopback-secret"}, clear=False):
            credentials = store.resolve_credentials(_spec("cliproxy"))
            self.assertTrue(credentials.usable)
            self.assertEqual(credentials.api_key, "loopback-secret")

    def test_a_stored_key_still_configures_a_paid_provider(self) -> None:
        store.upsert_provider("anthropic", api_key="sk-stored-explicitly")
        self.assertTrue(store.is_configured(_spec("anthropic")))

    def test_stored_key_wins_over_environment(self) -> None:
        store.upsert_provider("anthropic", api_key="sk-stored")
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-from-env"}, clear=False):
            credentials = store.resolve_credentials(_spec("anthropic"))
            self.assertEqual(credentials.api_key, "sk-stored")

    def test_deleting_a_provider_clears_the_stored_key(self) -> None:
        store.upsert_provider("anthropic", api_key="sk-ant-key")
        self.assertTrue(store.delete_provider("anthropic"))
        self.assertFalse(store.is_configured(_spec("anthropic")))

    def test_a_keyless_provider_still_needs_an_endpoint(self) -> None:
        # Ollama used to be catalogued here and counted as configured from its
        # default base URL alone, so its models appeared in the picker whether
        # or not anything was listening. The keyless provider that remains
        # stays unconfigured until pointed somewhere real.
        self.assertFalse(store.is_configured(_spec("custom")))
        store.upsert_provider("custom", base_url="http://127.0.0.1:9000/v1")
        self.assertTrue(store.is_configured(_spec("custom")))

    def test_ollama_is_no_longer_a_provider(self) -> None:
        from chatmock.providers.catalog import provider_spec

        self.assertIsNone(provider_spec("ollama"))
        # A stale providers.json entry must be ignored, not crash the read.
        store.write_settings(
            store.ProviderSettings(providers={"cliproxy": store.ProviderRecord(api_key="k")})
        )
        self.assertNotIn("ollama", {entry["id"] for entry in store.public_state()})

    def test_settings_are_reread_after_a_write(self) -> None:
        self.assertFalse(store.is_configured(_spec("anthropic")))
        store.upsert_provider("anthropic", api_key="sk-ant-key")
        # A running proxy must see a key added through the API without restart.
        self.assertTrue(store.is_configured(_spec("anthropic")))

    def test_default_model_round_trips(self) -> None:
        self.assertEqual(store.get_default_model("gpt-5.6-sol"), "gpt-5.6-sol")
        store.set_default_model("anthropic/claude-opus-4-5")
        self.assertEqual(store.get_default_model("gpt-5.6-sol"), "anthropic/claude-opus-4-5")
        store.set_default_model(None)
        self.assertEqual(store.get_default_model("gpt-5.6-sol"), "gpt-5.6-sol")

    def test_sentinel_is_never_stored_as_the_default(self) -> None:
        store.set_default_model("default")
        self.assertIsNone(store.read_settings().default_model)


class ModelResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch.dict(
            os.environ,
            {
                "CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json"),
                "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(self.tmp.name, "model-routing.jsonl"),
                "CHATMOCK_FAILOVER_FILE": os.path.join(self.tmp.name, "failover.json"),
            },
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("CHATMOCK_DEFAULT_MODEL", None)
        os.environ.pop("ANTHROPIC_API_KEY", None)

    def test_bare_ids_stay_on_chatgpt(self) -> None:
        resolved = resolve_model("gpt-5.6-sol")
        self.assertTrue(resolved.is_chatgpt)
        self.assertEqual(resolved.upstream_model, "gpt-5.6-sol")

    def test_chatgpt_aliases_still_normalize(self) -> None:
        self.assertEqual(resolve_model("gpt-5.6").upstream_model, "gpt-5.6-sol")

    def test_provider_prefix_selects_the_provider(self) -> None:
        resolved = resolve_model("anthropic/claude-opus-4-5")
        self.assertFalse(resolved.is_chatgpt)
        self.assertEqual(resolved.provider.id, "anthropic")
        self.assertEqual(resolved.upstream_model, "claude-opus-4-5")
        self.assertEqual(resolved.public_model, "anthropic/claude-opus-4-5")

    def test_only_the_first_segment_is_a_provider(self) -> None:
        # OpenRouter ids are themselves vendor-scoped; the rest must survive.
        resolved = resolve_model("openrouter/anthropic/claude-sonnet-4.5")
        self.assertEqual(resolved.provider.id, "openrouter")
        self.assertEqual(resolved.upstream_model, "anthropic/claude-sonnet-4.5")

    def test_case_is_preserved_for_external_ids(self) -> None:
        resolved = resolve_model("together/meta-llama/Llama-3.3-70B-Instruct-Turbo")
        self.assertEqual(resolved.upstream_model, "meta-llama/Llama-3.3-70B-Instruct-Turbo")

    def test_unknown_vendor_prefix_is_flagged(self) -> None:
        resolved = resolve_model("legacy/model-a")
        self.assertTrue(resolved.is_unknown_external)

    def test_explicit_chatgpt_prefix_is_stripped(self) -> None:
        resolved = resolve_model("chatgpt/gpt-5.6-sol")
        self.assertTrue(resolved.is_chatgpt)
        self.assertEqual(resolved.upstream_model, "gpt-5.6-sol")

    def test_sentinel_expands_to_the_configured_default(self) -> None:
        store.upsert_provider("anthropic", api_key="sk-ant-key")
        store.set_default_model("anthropic/claude-opus-4-5")

        resolved = resolve_model("default")
        self.assertEqual(resolved.provider.id, "anthropic")
        self.assertEqual(resolved.public_model, "anthropic/claude-opus-4-5")
        self.assertEqual(default_model(), "anthropic/claude-opus-4-5")

    def test_sentinel_without_a_default_falls_back_to_chatgpt(self) -> None:
        resolved = resolve_model("default")
        self.assertTrue(resolved.is_chatgpt)
        self.assertEqual(resolved.upstream_model, "gpt-5.6-sol")

    def test_environment_default_overrides_the_stored_default(self) -> None:
        store.set_default_model("anthropic/claude-opus-4-5")
        with patch.dict(os.environ, {"CHATMOCK_DEFAULT_MODEL": "gpt-5.5"}, clear=False):
            self.assertEqual(default_model(), "gpt-5.5")

    def test_external_ids_are_listed_only_once_configured(self) -> None:
        self.assertEqual(
            [mid for mid in external_model_ids() if mid.startswith("anthropic/")],
            [],
        )
        store.upsert_provider("anthropic", api_key="sk-ant-key", models=["claude-custom"])
        listed = external_model_ids()
        self.assertIn("anthropic/claude-custom", listed)
        self.assertIn("anthropic/claude-opus-4-5", listed)

    def test_model_entries_keep_chatgpt_ids_first(self) -> None:
        store.upsert_provider("anthropic", api_key="sk-ant-key")
        entries = model_entries(["gpt-5.6-sol"])
        self.assertEqual(entries[0]["id"], "gpt-5.6-sol")
        self.assertEqual(entries[0]["owned_by"], "chatgpt")
        self.assertTrue(any(e["owned_by"] == "anthropic" for e in entries))

    def test_model_entries_advertise_reasoning_efforts(self) -> None:
        """The UI builds its intelligence modes from this, so every row must
        say what the model actually honours."""
        store.upsert_provider("anthropic", api_key="sk-ant-key")
        store.upsert_provider("custom", base_url="http://127.0.0.1:11434/v1", models=["llama3.3"])
        entries = {entry["id"]: entry["reasoning_efforts"] for entry in model_entries(["gpt-5.6-sol"])}

        # GPT-5.6 carries the full ladder, including max.
        self.assertEqual(entries["gpt-5.6-sol"], ["low", "medium", "high", "xhigh", "max"])
        # Claude gets the levels ChatMock maps onto thinking budgets.
        self.assertEqual(entries["anthropic/claude-opus-4-5"], ["low", "medium", "high"])
        # A plain OpenAI-compatible endpoint has no reasoning notion; the UI
        # must offer no modes at all.
        self.assertEqual(entries["custom/llama3.3"], [])

    def test_reasoning_efforts_follow_the_specific_chatgpt_model(self) -> None:
        # gpt-5.1 allows only low/medium/high; offering xhigh would be a lie.
        self.assertEqual(reasoning_efforts_for("gpt-5.1"), ["low", "medium", "high"])
        self.assertIn("max", reasoning_efforts_for("gpt-5.6-sol"))
        # The sentinel reports the efforts of whatever it resolves to.
        self.assertEqual(reasoning_efforts_for("default"), reasoning_efforts_for("gpt-5.6-sol"))


class DispatchReasoningTests(unittest.TestCase):
    """The provider path's single reasoning chokepoint.

    Provider clients all read `reasoning_effort`, so a caller that speaks the
    Responses shape (`reasoning: {...}`) must not lose its chosen depth just
    because the model resolved to a provider instead of ChatGPT.
    """

    def test_responses_shaped_reasoning_is_promoted(self) -> None:
        resolved = resolve_model("anthropic/claude-opus-4-5")
        payload = dispatch._with_supported_reasoning(
            {"messages": [], "reasoning": {"effort": "High"}}, resolved
        )
        self.assertEqual(payload["reasoning_effort"], "high")

    def test_top_level_effort_wins_over_the_responses_shape(self) -> None:
        resolved = resolve_model("anthropic/claude-opus-4-5")
        payload = dispatch._with_supported_reasoning(
            {"messages": [], "reasoning": {"effort": "low"}, "reasoning_effort": "high"},
            resolved,
        )
        self.assertEqual(payload["reasoning_effort"], "high")

    def test_promoted_effort_the_model_lacks_is_still_dropped(self) -> None:
        # Anthropic honours low/medium/high only; `max` must not be forwarded.
        resolved = resolve_model("anthropic/claude-opus-4-5")
        payload = dispatch._with_supported_reasoning(
            {"messages": [], "reasoning": {"effort": "max"}}, resolved
        )
        self.assertNotIn("reasoning_effort", payload)

    def test_a_request_without_reasoning_is_untouched(self) -> None:
        resolved = resolve_model("anthropic/claude-opus-4-5")
        original = {"messages": []}
        self.assertIs(dispatch._with_supported_reasoning(original, resolved), original)


class ProviderRouterTests(unittest.TestCase):
    """Council routing: configured providers are used, others fall back."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch.dict(
            os.environ,
            {
                "CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json"),
                "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(self.tmp.name, "model-routing.jsonl"),
                "CHATMOCK_FAILOVER_FILE": os.path.join(self.tmp.name, "failover.json"),
            },
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("ANTHROPIC_API_KEY", None)

    def test_unconfigured_provider_falls_back_to_chatgpt(self) -> None:
        router = ProviderRouter(CouncilConfig())
        self.assertEqual(router.effective_model("anthropic/claude-opus-4-5"), "gpt-5.6-sol")

    def test_configured_provider_is_kept(self) -> None:
        store.upsert_provider("anthropic", api_key="sk-ant-key")
        router = ProviderRouter(CouncilConfig())
        self.assertEqual(
            router.effective_model("anthropic/claude-opus-4-5"),
            "anthropic/claude-opus-4-5",
        )

    def test_unknown_vendor_prefix_falls_back(self) -> None:
        router = ProviderRouter(CouncilConfig())
        self.assertEqual(router.effective_model("legacy/model-a"), "gpt-5.6-sol")

    def test_call_routes_to_the_provider_and_returns_out_params(self) -> None:
        store.upsert_provider("anthropic", api_key="sk-ant-key")
        router = ProviderRouter(CouncilConfig())
        call = ModelCall(model="anthropic/claude-opus-4-5", messages=[{"role": "user", "content": "hi"}])

        captured: dict = {}

        def fake_call_model(routed_call, credentials, upstream_model):
            captured["model"] = upstream_model
            captured["provider"] = credentials.provider_id
            routed_call.reasoning_out = "thought"
            return "answer"

        with patch.object(anthropic, "call_model", side_effect=fake_call_model):
            self.assertEqual(router.call_model(call), "answer")

        self.assertEqual(captured, {"model": "claude-opus-4-5", "provider": "anthropic"})
        self.assertEqual(call.reasoning_out, "thought")
        self.assertEqual(len(call.model_attempts_out), 1)
        route = call.model_attempts_out[0]
        self.assertEqual(route["requestedModel"], "anthropic/claude-opus-4-5")
        self.assertEqual(route["resolvedModel"], "anthropic/claude-opus-4-5")
        self.assertEqual(route["upstreamModel"], "claude-opus-4-5")
        self.assertEqual(route["provider"], "anthropic")
        self.assertEqual(route["outcome"], "succeeded")
        self.assertFalse(route["fallback"])

    def test_council_router_records_quota_failover_and_serving_model(self) -> None:
        store.upsert_provider("anthropic", api_key="sk-ant-key")

        class FallbackUpstream:
            def call_model(self, routed_call):
                return "chatgpt fallback"

        router = ProviderRouter(CouncilConfig(), upstream=FallbackUpstream())
        call = ModelCall(
            model="anthropic/claude-opus-4-5",
            client_requested_model="default",
            request_id="crun_route_audit",
            messages=[{"role": "user", "content": "hi"}],
        )

        with patch.object(
            anthropic,
            "call_model",
            side_effect=ProviderError("usage limit reached"),
        ):
            self.assertEqual(router.call_model(call), "chatgpt fallback")

        self.assertEqual(len(call.model_attempts_out), 2)
        exhausted, served = call.model_attempts_out
        self.assertEqual(exhausted["requestedModel"], "default")
        self.assertEqual(exhausted["callModel"], "anthropic/claude-opus-4-5")
        self.assertEqual(exhausted["upstreamModel"], "claude-opus-4-5")
        self.assertEqual(exhausted["outcome"], "quota_exhausted")
        self.assertFalse(exhausted["fallback"])
        self.assertEqual(served["upstreamModel"], "gpt-5.6-sol")
        self.assertEqual(served["outcome"], "succeeded")
        self.assertTrue(served["fallback"])


class OpenAICompatibleTests(unittest.TestCase):
    def _credentials(self) -> ResolvedCredentials:
        return ResolvedCredentials("groq", "gsk-key", "https://api.groq.com/openai/v1", True)

    def test_payload_forwards_only_known_fields(self) -> None:
        payload = openai_compatible.build_payload(
            {
                "messages": [{"role": "user", "content": "hi"}],
                "temperature": 0.4,
                "tools": [{"type": "function"}],
                # Breadboard's own routing fields must never reach a third party.
                "taskType": "topic_map",
                "gardenId": "garden-1",
                "responses_tools": [{"type": "web_search"}],
            },
            "llama-3.3-70b",
            stream=True,
        )
        self.assertEqual(payload["model"], "llama-3.3-70b")
        self.assertTrue(payload["stream"])
        self.assertIn("temperature", payload)
        self.assertIn("tools", payload)
        self.assertNotIn("taskType", payload)
        self.assertNotIn("gardenId", payload)
        self.assertNotIn("responses_tools", payload)

    def test_no_argument_tools_get_an_explicit_schema(self) -> None:
        """OpenAI lets a no-arg tool omit `parameters`, but a gateway backed by
        Anthropic forwards it as the required `input_schema` and rejects the
        request with `tools.0.custom.input_schema: Field required`."""
        payload = openai_compatible.build_payload(
            {
                "messages": [],
                "tools": [{"type": "function", "function": {"name": "noop"}}],
            },
            "claude-opus-4-5",
            stream=False,
        )
        self.assertEqual(
            payload["tools"][0]["function"]["parameters"],
            {"type": "object", "properties": {}},
        )

    def test_existing_tool_schemas_are_left_alone(self) -> None:
        schema = {"type": "object", "properties": {"q": {"type": "string"}}}
        payload = openai_compatible.build_payload(
            {
                "messages": [],
                "tools": [
                    {"type": "function", "function": {"name": "search", "parameters": schema}}
                ],
            },
            "model",
            stream=False,
        )
        self.assertEqual(payload["tools"][0]["function"]["parameters"], schema)

    def test_chat_url_appends_the_path_once(self) -> None:
        self.assertEqual(
            openai_compatible.chat_url(self._credentials()),
            "https://api.groq.com/openai/v1/chat/completions",
        )

    def test_bearer_header_is_set(self) -> None:
        headers = openai_compatible.build_headers(self._credentials())
        self.assertEqual(headers["Authorization"], "Bearer gsk-key")

    def test_call_model_extracts_text_reasoning_and_usage(self) -> None:
        body = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "the answer",
                        "reasoning_content": "the thinking",
                    }
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14},
        }
        call = ModelCall(model="groq/llama", messages=[{"role": "user", "content": "hi"}])
        with patch.object(openai_compatible, "request_chat", return_value=FakeResponse(body=body)):
            text = openai_compatible.call_model(call, self._credentials(), "llama-3.3-70b")

        self.assertEqual(text, "the answer")
        self.assertEqual(call.reasoning_out, "the thinking")
        self.assertEqual(call.usage_out.total_tokens, 14)

    def test_http_error_surfaces_the_upstream_reason_not_the_credential(self) -> None:
        """The upstream's own sentence is written for the person who has to act
        on it, and clients render it as the assistant's answer — so it is passed
        through alone, while the key that was rejected never appears."""
        response = FakeResponse(status_code=401, body={"error": {"message": "Invalid API key"}})
        call = ModelCall(model="groq/llama", messages=[])
        with patch.object(openai_compatible, "request_chat", return_value=response):
            with self.assertRaises(ProviderError) as caught:
                openai_compatible.call_model(call, self._credentials(), "llama-3.3-70b")
        self.assertEqual(str(caught.exception), "Invalid API key")
        self.assertNotIn("gsk-key", str(caught.exception))

    def test_http_error_without_a_reason_falls_back_to_the_status(self) -> None:
        response = FakeResponse(status_code=503, body={})
        call = ModelCall(model="groq/llama", messages=[])
        with patch.object(openai_compatible, "request_chat", return_value=response):
            with self.assertRaises(ProviderError) as caught:
                openai_compatible.call_model(call, self._credentials(), "llama-3.3-70b")
        self.assertIn("503", str(caught.exception))

    def test_relay_stream_preserves_frames(self) -> None:
        response = FakeResponse(
            lines=['data: {"choices":[{"delta":{"content":"hi"}}]}', "", "data: [DONE]"]
        )
        frames = b"".join(openai_compatible.relay_stream(response))
        self.assertIn(b'"content":"hi"', frames)
        self.assertIn(b"data: [DONE]", frames)
        self.assertTrue(response.closed)


class AnthropicTranslationTests(unittest.TestCase):
    def _credentials(self) -> ResolvedCredentials:
        return ResolvedCredentials("anthropic", "sk-ant", "https://api.anthropic.com", True)

    def test_system_messages_move_to_the_system_field(self) -> None:
        messages, system = anthropic.convert_messages(
            [
                {"role": "system", "content": "be brief"},
                {"role": "user", "content": "hello"},
            ]
        )
        self.assertEqual(system, "be brief")
        self.assertEqual(messages, [{"role": "user", "content": [{"type": "text", "text": "hello"}]}])

    def test_tool_results_become_user_blocks(self) -> None:
        messages, _ = anthropic.convert_messages(
            [
                {"role": "user", "content": "search"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "search", "arguments": '{"q":"x"}'},
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": "call_1", "content": "result text"},
            ]
        )
        self.assertEqual(messages[1]["content"][0]["type"], "tool_use")
        self.assertEqual(messages[1]["content"][0]["input"], {"q": "x"})
        self.assertEqual(messages[2]["content"][0]["type"], "tool_result")
        self.assertEqual(messages[2]["role"], "user")

    def test_leading_assistant_turn_is_dropped(self) -> None:
        messages, _ = anthropic.convert_messages(
            [{"role": "assistant", "content": "hi"}, {"role": "user", "content": "hello"}]
        )
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["role"], "user")

    def test_max_tokens_is_always_present(self) -> None:
        payload = anthropic.build_payload(
            {"messages": [{"role": "user", "content": "hi"}]}, "claude-opus-4-5", stream=False
        )
        self.assertEqual(payload["max_tokens"], anthropic.DEFAULT_MAX_TOKENS)

        payload = anthropic.build_payload(
            {"messages": [], "max_tokens": 128}, "claude-opus-4-5", stream=False
        )
        self.assertEqual(payload["max_tokens"], 128)

    def test_reasoning_effort_becomes_a_thinking_budget(self) -> None:
        """Anthropic has no reasoning_effort; without this mapping the UI's
        intelligence modes would be a control that does nothing for Claude."""
        payload = anthropic.build_payload(
            {"messages": [{"role": "user", "content": "hi"}], "reasoning_effort": "high"},
            "claude-opus-4-5",
            stream=False,
        )
        self.assertEqual(payload["thinking"], {"type": "enabled", "budget_tokens": 16384})
        # max_tokens must exceed the budget or the API rejects the request.
        self.assertGreater(payload["max_tokens"], 16384)

    def test_thinking_suppresses_temperature(self) -> None:
        # Anthropic rejects a custom temperature alongside extended thinking.
        payload = anthropic.build_payload(
            {
                "messages": [{"role": "user", "content": "hi"}],
                "reasoning_effort": "low",
                "temperature": 0.2,
                "top_p": 0.9,
            },
            "claude-opus-4-5",
            stream=False,
        )
        self.assertNotIn("temperature", payload)
        self.assertNotIn("top_p", payload)

        # Without a thinking budget the sampling controls pass through.
        plain = anthropic.build_payload(
            {"messages": [], "temperature": 0.2}, "claude-opus-4-5", stream=False
        )
        self.assertEqual(plain["temperature"], 0.2)

    def test_unknown_effort_leaves_thinking_off(self) -> None:
        payload = anthropic.build_payload(
            {"messages": [], "reasoning_effort": "xhigh"}, "claude-opus-4-5", stream=False
        )
        self.assertNotIn("thinking", payload)

    def test_openai_tools_convert_to_anthropic_schema(self) -> None:
        payload = anthropic.build_payload(
            {
                "messages": [{"role": "user", "content": "hi"}],
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "lookup",
                            "description": "look things up",
                            "parameters": {"type": "object", "properties": {}},
                        },
                    }
                ],
                "tool_choice": "required",
            },
            "claude-opus-4-5",
            stream=False,
        )
        self.assertEqual(payload["tools"][0]["name"], "lookup")
        self.assertIn("input_schema", payload["tools"][0])
        self.assertEqual(payload["tool_choice"], {"type": "any"})

    def test_response_translation_maps_content_and_stop_reason(self) -> None:
        body = {
            "id": "msg_1",
            "content": [
                {"type": "thinking", "thinking": "hmm"},
                {"type": "text", "text": "the answer"},
            ],
            "stop_reason": "max_tokens",
            "usage": {
                "input_tokens": 12,
                "cache_creation_input_tokens": 7,
                "cache_read_input_tokens": 30,
                "output_tokens": 5,
            },
        }
        completion = anthropic.translate_response(body, public_model="anthropic/claude-opus-4-5")
        message = completion["choices"][0]["message"]
        self.assertEqual(message["content"], "the answer")
        self.assertEqual(message["reasoning_content"], "hmm")
        self.assertEqual(completion["choices"][0]["finish_reason"], "length")
        self.assertEqual(completion["usage"]["prompt_tokens"], 49)
        self.assertEqual(completion["usage"]["total_tokens"], 54)
        self.assertEqual(
            completion["usage"]["prompt_tokens_details"], {"cached_tokens": 30}
        )
        self.assertEqual(completion["model"], "anthropic/claude-opus-4-5")

    def test_tool_use_blocks_become_openai_tool_calls(self) -> None:
        body = {
            "content": [{"type": "tool_use", "id": "toolu_1", "name": "lookup", "input": {"q": "x"}}],
            "stop_reason": "tool_use",
        }
        completion = anthropic.translate_response(body, public_model="anthropic/claude-opus-4-5")
        tool_calls = completion["choices"][0]["message"]["tool_calls"]
        self.assertEqual(tool_calls[0]["function"]["name"], "lookup")
        self.assertEqual(json.loads(tool_calls[0]["function"]["arguments"]), {"q": "x"})
        self.assertEqual(completion["choices"][0]["finish_reason"], "tool_calls")

    def test_call_model_preserves_anthropic_cache_usage(self) -> None:
        body = {
            "content": [{"type": "text", "text": "answer"}],
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": 10,
                "cache_creation_input_tokens": 5,
                "cache_read_input_tokens": 20,
                "output_tokens": 4,
            },
        }
        call = ModelCall(
            model="anthropic/claude-opus-4-5",
            messages=[{"role": "user", "content": "hi"}],
        )
        with patch.object(anthropic, "request_chat", return_value=FakeResponse(body=body)):
            text = anthropic.call_model(call, self._credentials(), "claude-opus-4-5")

        self.assertEqual(text, "answer")
        self.assertEqual(call.usage_out.input_tokens, 35)
        self.assertEqual(call.usage_out.output_tokens, 4)
        self.assertEqual(call.usage_out.total_tokens, 39)
        self.assertEqual(call.usage_out.cached_input_tokens, 20)

    def test_stream_translation_emits_openai_chunks(self) -> None:
        events = [
            {
                "type": "message_start",
                "message": {
                    "usage": {
                        "input_tokens": 9,
                        "cache_creation_input_tokens": 4,
                        "cache_read_input_tokens": 6,
                        "output_tokens": 0,
                    }
                },
            },
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "he"}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "llo"}},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 3}},
            {"type": "message_stop"},
        ]
        response = FakeResponse(lines=[f"data: {json.dumps(e)}" for e in events])
        frames = list(
            anthropic.translate_stream(
                response, public_model="anthropic/claude-opus-4-5", include_usage=True
            )
        )
        text = b"".join(frames).decode("utf-8")

        self.assertIn('"role": "assistant"', text)
        self.assertIn('"content": "he"', text)
        self.assertIn('"content": "llo"', text)
        self.assertIn('"finish_reason": "stop"', text)
        self.assertIn('"total_tokens": 22', text)
        self.assertIn('"cached_tokens": 6', text)
        self.assertTrue(text.strip().endswith("data: [DONE]"))
        self.assertTrue(response.closed)

    def test_stream_translation_emits_tool_call_deltas(self) -> None:
        events = [
            {"type": "message_start", "message": {"usage": {}}},
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "tool_use", "id": "toolu_1", "name": "lookup"},
            },
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "input_json_delta", "partial_json": '{"q":'},
            },
            {"type": "message_delta", "delta": {"stop_reason": "tool_use"}},
        ]
        response = FakeResponse(lines=[f"data: {json.dumps(e)}" for e in events])
        text = b"".join(
            anthropic.translate_stream(
                response, public_model="anthropic/claude-opus-4-5", include_usage=False
            )
        ).decode("utf-8")

        self.assertIn('"name": "lookup"', text)
        self.assertIn('{\\"q\\":', text)
        self.assertIn('"finish_reason": "tool_calls"', text)


class ProviderRoutesTests(unittest.TestCase):
    """The management API and provider-aware model listing."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch.dict(
            os.environ,
            {
                "CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json"),
                "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(self.tmp.name, "model-routing.jsonl"),
            },
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
            os.environ.pop(name, None)
        self.app = create_app()
        self.client = self.app.test_client()

    def test_provider_list_is_redacted(self) -> None:
        self.client.put("/v1/providers/anthropic", json={"apiKey": "sk-ant-secret-value"})
        response = self.client.get("/v1/providers")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("sk-ant-secret-value", response.get_data(as_text=True))

        entry = next(p for p in response.get_json()["providers"] if p["id"] == "anthropic")
        self.assertTrue(entry["configured"])

    def test_unknown_provider_is_rejected(self) -> None:
        self.assertEqual(self.client.put("/v1/providers/nope", json={"apiKey": "x"}).status_code, 404)

    def test_empty_api_key_clears_the_stored_key(self) -> None:
        self.client.put("/v1/providers/anthropic", json={"apiKey": "sk-ant-key"})
        self.client.put("/v1/providers/anthropic", json={"apiKey": ""})
        entry = next(
            p for p in self.client.get("/v1/providers").get_json()["providers"] if p["id"] == "anthropic"
        )
        self.assertFalse(entry["hasStoredKey"])
        self.assertFalse(entry["configured"])

    def test_default_model_requires_a_reachable_provider(self) -> None:
        rejected = self.client.put(
            "/v1/settings/default-model", json={"model": "anthropic/claude-opus-4-5"}
        )
        self.assertEqual(rejected.status_code, 400)

        self.client.put("/v1/providers/anthropic", json={"apiKey": "sk-ant-key"})
        accepted = self.client.put(
            "/v1/settings/default-model", json={"model": "anthropic/claude-opus-4-5"}
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.get_json()["defaultModel"], "anthropic/claude-opus-4-5")

    def test_chatgpt_default_model_is_always_allowed(self) -> None:
        response = self.client.put("/v1/settings/default-model", json={"model": "gpt-5.5"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/v1/settings/default-model").get_json()["defaultModel"], "gpt-5.5")

    def test_models_endpoint_lists_configured_providers(self) -> None:
        before = [m["id"] for m in self.client.get("/v1/models").get_json()["data"]]
        self.assertIn("gpt-5.6-sol", before)
        self.assertFalse(any(mid.startswith("anthropic/") for mid in before))

        self.client.put("/v1/providers/anthropic", json={"apiKey": "sk-ant-key"})
        after = [m["id"] for m in self.client.get("/v1/models").get_json()["data"]]
        self.assertIn("anthropic/claude-opus-4-5", after)

    def test_responses_endpoint_adapts_external_models_and_tools(self) -> None:
        self.client.put("/v1/providers/anthropic", json={"apiKey": "sk-ant-key"})
        body = {
            "id": "msg_1",
            "content": [
                {"type": "text", "text": "I will inspect it."},
                {"type": "tool_use", "id": "tool_1", "name": "shell_command", "input": {"command": "git status"}},
            ],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 8, "output_tokens": 5},
        }
        with patch.object(anthropic, "request_chat", return_value=FakeResponse(body=body)) as mocked:
            response = self.client.post(
                "/v1/responses",
                json={
                    "model": "anthropic/claude-opus-4-5",
                    "instructions": "You are a coding agent.",
                    "input": "inspect the repository",
                    "stream": True,
                    "tools": [
                        {
                            "type": "function",
                            "name": "shell_command",
                            "description": "Run a command",
                            "parameters": {
                                "type": "object",
                                "properties": {"command": {"type": "string"}},
                                "required": ["command"],
                            },
                        }
                    ],
                },
            )

        self.assertEqual(response.status_code, 200)
        text = response.get_data(as_text=True)
        self.assertIn('"type": "response.completed"', text)
        self.assertIn('"type": "function_call"', text)
        self.assertIn('"name": "shell_command"', text)
        outbound = mocked.call_args.args[1]
        self.assertEqual(
            outbound["messages"][0],
            {"role": "system", "content": "You are a coding agent."},
        )

    def test_chat_completions_routes_to_the_provider(self) -> None:
        self.client.put("/v1/providers/anthropic", json={"apiKey": "sk-ant-key"})
        body = {
            "id": "msg_1",
            "content": [{"type": "text", "text": "routed answer"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 3, "output_tokens": 2},
        }
        with patch.object(anthropic, "request_chat", return_value=FakeResponse(body=body)) as mocked:
            response = self.client.post(
                "/v1/chat/completions",
                json={
                    "model": "anthropic/claude-opus-4-5",
                    "messages": [{"role": "user", "content": "hi"}],
                    # Tool payloads bypass the council, exercising the passthrough.
                    "tools": [{"type": "function", "function": {"name": "noop"}}],
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["choices"][0]["message"]["content"], "routed answer")
        self.assertEqual(payload["model"], "anthropic/claude-opus-4-5")
        self.assertEqual(mocked.call_args.args[2], "claude-opus-4-5")

    def test_council_mediated_chat_reaches_the_provider(self) -> None:
        """A plain chat request is council-mediated; the seat must still land on
        the chosen provider rather than silently reverting to ChatGPT."""
        self.client.put("/v1/providers/anthropic", json={"apiKey": "sk-ant-key"})
        seen: dict = {}

        def fake_call_model(call, credentials, upstream_model):
            seen["provider"] = credentials.provider_id
            seen["model"] = upstream_model
            return "council answer"

        with patch.object(anthropic, "call_model", side_effect=fake_call_model):
            response = self.client.post(
                "/v1/chat/completions",
                json={
                    "model": "anthropic/claude-opus-4-5",
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen, {"provider": "anthropic", "model": "claude-opus-4-5"})
        self.assertEqual(
            response.get_json()["choices"][0]["message"]["content"], "council answer"
        )

    def test_default_sentinel_reaches_the_selected_provider(self) -> None:
        """`model: "default"` is what Hermes/OpenCode/UI-TARS send, so the global
        selection has to take effect without those processes restarting."""
        self.client.put("/v1/providers/anthropic", json={"apiKey": "sk-ant-key"})
        self.client.put("/v1/settings/default-model", json={"model": "anthropic/claude-opus-4-5"})
        seen: dict = {}

        def fake_call_model(call, credentials, upstream_model):
            seen["model"] = upstream_model
            return "default answer"

        with patch.object(anthropic, "call_model", side_effect=fake_call_model):
            response = self.client.post(
                "/v1/chat/completions",
                json={"model": "default", "messages": [{"role": "user", "content": "hi"}]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen["model"], "claude-opus-4-5")
        # The echoed id names a real model, not the sentinel.
        self.assertEqual(response.get_json()["model"], "anthropic/claude-opus-4-5")
        self.assertEqual(response.headers["X-ChatMock-Requested-Model"], "default")
        self.assertEqual(
            response.headers["X-ChatMock-Resolved-Model"],
            "anthropic/claude-opus-4-5",
        )
        telemetry = [
            json.loads(line)
            for line in Path(os.environ["CHATMOCK_MODEL_TELEMETRY_FILE"]).read_text(
                encoding="utf-8"
            ).splitlines()
            if line.strip()
        ]
        self.assertEqual(telemetry[-1]["requestedModel"], "default")
        self.assertEqual(
            telemetry[-1]["upstreamModel"],
            "claude-opus-4-5",
        )

    def test_unsupported_effort_is_stripped_before_dispatch(self) -> None:
        """A plain OpenAI-compatible endpoint declares no reasoning ladder, and
        several such upstreams reject unknown fields outright — so an effort the
        model does not honour must not travel with the request."""
        self.client.put(
            "/v1/providers/custom",
            json={"baseUrl": "http://127.0.0.1:11434/v1", "models": ["llama3.3"]},
        )
        seen: dict = {}

        def capture(credentials, payload, upstream_model, *, stream):
            seen["payload"] = payload
            return FakeResponse(body={"choices": [{"message": {"content": "ok"}}]})

        with patch.object(openai_compatible, "request_chat", side_effect=capture):
            self.client.post(
                "/v1/chat/completions",
                json={
                    "model": "custom/llama3.3",
                    "messages": [{"role": "user", "content": "hi"}],
                    "reasoning_effort": "high",
                    "tools": [{"type": "function", "function": {"name": "noop"}}],
                },
            )

        self.assertNotIn("reasoning_effort", seen["payload"])

    def test_supported_effort_survives_dispatch(self) -> None:
        self.client.put("/v1/providers/anthropic", json={"apiKey": "sk-ant-key"})
        seen: dict = {}

        def capture(credentials, payload, upstream_model, *, stream):
            seen["payload"] = payload
            return FakeResponse(body={"content": [{"type": "text", "text": "ok"}]})

        with patch.object(anthropic, "request_chat", side_effect=capture):
            self.client.post(
                "/v1/chat/completions",
                json={
                    "model": "anthropic/claude-opus-4-5",
                    "messages": [{"role": "user", "content": "hi"}],
                    "reasoning_effort": "high",
                    "tools": [{"type": "function", "function": {"name": "noop"}}],
                },
            )

        self.assertEqual(seen["payload"]["reasoning_effort"], "high")

    def test_models_endpoint_reports_reasoning_efforts(self) -> None:
        data = self.client.get("/v1/models").get_json()["data"]
        entry = next(item for item in data if item["id"] == "gpt-5.6-sol")
        self.assertIn("max", entry["reasoning_efforts"])

    def test_unconfigured_provider_returns_a_clear_error(self) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "anthropic/claude-opus-4-5",
                "messages": [{"role": "user", "content": "hi"}],
                "tools": [{"type": "function", "function": {"name": "noop"}}],
            },
        )
        self.assertEqual(response.status_code, 503)
        self.assertIn("not available", response.get_json()["error"]["message"])


class ExhaustedModelPassthroughTests(unittest.TestCase):
    """A spent subscription quota on the plain ``/v1/chat/completions`` path.

    CLIProxyAPI benches a credential for about a minute after Google answers
    ``RESOURCE_EXHAUSTED``, and answers every request in that window with a 429
    ``model_cooldown``. With one Google account signed in there is nothing else
    to round-robin onto, so the model looks like it has stopped responding —
    unless ChatMock routes around it the way the council router already does.
    """

    COOLDOWN_BODY = {
        "error": {
            "code": "model_cooldown",
            "message": (
                "All credentials for model gemini-3.6-flash-high are cooling down "
                "via provider antigravity"
            ),
            "model": "gemini-3.6-flash-high",
            "provider": "antigravity",
            "reset_seconds": 52,
            "reset_time": "52s",
        }
    }

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch.dict(
            os.environ,
            {
                "CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json"),
                "CHATMOCK_FAILOVER_FILE": os.path.join(self.tmp.name, "failover.json"),
                "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(self.tmp.name, "model-routing.jsonl"),
            },
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.app = create_app()
        self.client = self.app.test_client()

    def _configure(self, models: list[str]) -> None:
        store.upsert_provider("cliproxy", api_key="loopback-secret", models=models)

    def _ask(self, model: str):
        return self.client.post(
            "/v1/chat/completions",
            json={
                "model": model,
                "messages": [{"role": "user", "content": "hi"}],
                # Tool payloads bypass the council, exercising the passthrough.
                "tools": [{"type": "function", "function": {"name": "noop"}}],
            },
        )

    def _ask_responses(self, model: str):
        return self.client.post(
            "/v1/responses",
            json={
                "model": model,
                "input": "hi",
                "tools": [
                    {
                        "type": "function",
                        "name": "noop",
                        "description": "No operation",
                        "parameters": {"type": "object", "properties": {}},
                    }
                ],
            },
        )

    def test_exhausted_model_is_served_by_a_stand_in(self) -> None:
        self._configure(["gemini-3.6-flash-high", "claude-opus-5"])
        asked: list[str] = []
        identities: list[str] = []

        def respond(credentials, payload, upstream_model, *, stream):
            asked.append(upstream_model)
            identities.append(payload["messages"][0]["content"])
            if upstream_model == "gemini-3.6-flash-high":
                return FakeResponse(status_code=429, body=self.COOLDOWN_BODY)
            return FakeResponse(body={"choices": [{"message": {"content": "stood in"}}]})

        with (
            patch.object(openai_compatible, "request_chat", side_effect=respond),
            patch.object(claude_code, "request_chat", side_effect=respond),
        ):
            response = self.client.post(
                "/v1/chat/completions",
                json={
                    "model": "cliproxy/gemini-3.6-flash-high",
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                f"Model: {RESOLVED_MODEL_PLACEHOLDER}\n"
                                f"Provider: {RESOLVED_PROVIDER_PLACEHOLDER}"
                            ),
                        },
                        {"role": "user", "content": "hi"},
                    ],
                    "tools": [{"type": "function", "function": {"name": "noop"}}],
                },
            )

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["choices"][0]["message"]["content"], "stood in")
        self.assertEqual(body["model"], "cliproxy/claude-opus-5")
        self.assertEqual(response.headers["X-ChatMock-Failover"], "true")
        self.assertEqual(
            response.headers["X-ChatMock-Upstream-Model"], "claude-opus-5"
        )
        self.assertEqual(asked, ["gemini-3.6-flash-high", "claude-opus-5"])
        self.assertEqual(
            identities,
            [
                "Model: cliproxy/gemini-3.6-flash-high\nProvider: cliproxy",
                "Model: cliproxy/claude-opus-5\nProvider: cliproxy",
            ],
        )
        attempts = [
            json.loads(line)
            for line in Path(os.environ["CHATMOCK_MODEL_TELEMETRY_FILE"]).read_text(
                encoding="utf-8"
            ).splitlines()
            if line.strip()
        ]
        self.assertEqual(len(attempts), 2)
        self.assertEqual({item["requestId"] for item in attempts}, {attempts[0]["requestId"]})
        self.assertEqual(attempts[0]["outcome"], "quota_exhausted")
        self.assertEqual(attempts[0]["upstreamModel"], "gemini-3.6-flash-high")
        self.assertEqual(attempts[1]["outcome"], "succeeded")
        self.assertEqual(attempts[1]["upstreamModel"], "claude-opus-5")
        self.assertTrue(attempts[1]["fallback"])

    def test_transient_google_exhaustion_tries_one_google_sibling(self) -> None:
        self._configure(
            [
                "gemini-3.6-flash-high",
                "kimi-k2.5",
                "gemini-3.1-pro-low",
                "gemini-3.5-flash-low",
                "claude-opus-5",
            ]
        )
        asked: list[str] = []

        def respond(credentials, payload, upstream_model, *, stream):
            asked.append(upstream_model)
            if upstream_model == "gemini-3.6-flash-high":
                return FakeResponse(
                    status_code=429,
                    body={
                        "error": {
                            "code": 429,
                            "message": "Resource has been exhausted (e.g. check quota).",
                            "status": "RESOURCE_EXHAUSTED",
                        }
                    },
                )
            return FakeResponse(
                body={"choices": [{"message": {"content": "served promptly"}}]}
            )

        with (
            patch.object(openai_compatible, "request_chat", side_effect=respond),
            patch.object(claude_code, "request_chat", side_effect=respond),
        ):
            response = self._ask("cliproxy/gemini-3.6-flash-high")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            asked,
            ["gemini-3.6-flash-high", "gemini-3.1-pro-low"],
        )
        self.assertEqual(
            response.headers["X-ChatMock-Resolved-Model"],
            "cliproxy/gemini-3.1-pro-low",
        )
        self.assertFalse(failover.is_cooling("cliproxy/gemini-3.1-pro-low"))
        self.assertFalse(failover.is_cooling("cliproxy/gemini-3.5-flash-low"))
        self.assertLessEqual(
            failover.cooldown_for(
                "cliproxy/gemini-3.6-flash-high"
            ).remaining_seconds,
            15,
        )

    def test_a_recovered_gemini_call_clears_only_that_model(self) -> None:
        self._configure(
            [
                "gemini-3.6-flash-high",
                "gemini-3.1-pro-low",
                "claude-opus-5",
            ]
        )
        failover.note_exhausted(
            "cliproxy/gemini-3.6-flash-high",
            reason="Resource has been exhausted (e.g. check quota).",
        )
        failover.note_exhausted(
            "cliproxy/gemini-3.1-pro-low",
            reason="Resource has been exhausted (e.g. check quota).",
        )

        resolved = resolve_model("cliproxy/gemini-3.6-flash-high")
        dispatch.clear_recovered_model(resolved)

        self.assertFalse(failover.is_cooling("cliproxy/gemini-3.6-flash-high"))
        self.assertTrue(failover.is_cooling("cliproxy/gemini-3.1-pro-low"))

    def test_only_one_google_sibling_is_tried_before_claude(self) -> None:
        self._configure(
            [
                "gemini-3.6-flash-high",
                "gemini-3.1-pro-low",
                "gemini-3.5-flash-low",
                "claude-opus-5",
            ]
        )
        asked: list[str] = []

        def respond(credentials, payload, upstream_model, *, stream):
            asked.append(upstream_model)
            if upstream_model.startswith("gemini"):
                return FakeResponse(
                    status_code=429,
                    body={
                        "error": {
                            "code": 429,
                            "message": "Resource has been exhausted (e.g. check quota).",
                            "status": "RESOURCE_EXHAUSTED",
                        }
                    },
                )
            return FakeResponse(body={"choices": [{"message": {"content": "ok"}}]})

        with (
            patch.object(openai_compatible, "request_chat", side_effect=respond),
            patch.object(claude_code, "request_chat", side_effect=respond),
        ):
            response = self._ask("cliproxy/gemini-3.6-flash-high")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            asked,
            ["gemini-3.6-flash-high", "gemini-3.1-pro-low", "claude-opus-5"],
        )
        self.assertEqual(
            response.headers["X-ChatMock-Resolved-Model"],
            "cliproxy/claude-opus-5",
        )

    def test_known_cooldown_skips_the_exhausted_model_on_later_turns(self) -> None:
        self._configure(["gemini-3.6-flash-high", "claude-opus-5"])
        asked: list[str] = []

        def respond(credentials, payload, upstream_model, *, stream):
            asked.append(upstream_model)
            if upstream_model == "gemini-3.6-flash-high":
                return FakeResponse(status_code=429, body=self.COOLDOWN_BODY)
            return FakeResponse(body={"choices": [{"message": {"content": "ok"}}]})

        with (
            patch.object(openai_compatible, "request_chat", side_effect=respond),
            patch.object(claude_code, "request_chat", side_effect=respond),
        ):
            first = self._ask("cliproxy/gemini-3.6-flash-high")
            second = self._ask("cliproxy/gemini-3.6-flash-high")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(
            asked,
            ["gemini-3.6-flash-high", "claude-opus-5", "claude-opus-5"],
        )
        self.assertEqual(
            second.headers["X-ChatMock-Resolved-Model"],
            "cliproxy/claude-opus-5",
        )
        self.assertEqual(second.headers["X-ChatMock-Failover"], "true")

    def test_responses_adapter_reports_the_model_that_actually_served_codex(self) -> None:
        self._configure(["gemini-3.6-flash-high", "claude-opus-5"])

        def respond(credentials, payload, upstream_model, *, stream):
            if upstream_model == "gemini-3.6-flash-high":
                return FakeResponse(status_code=429, body=self.COOLDOWN_BODY)
            return FakeResponse(
                body={
                    "id": "chatcmpl-fallback",
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "served by opus",
                            },
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {
                        "prompt_tokens": 3,
                        "completion_tokens": 4,
                        "total_tokens": 7,
                    },
                }
            )

        with (
            patch.object(openai_compatible, "request_chat", side_effect=respond),
            patch.object(claude_code, "request_chat", side_effect=respond),
        ):
            response = self._ask_responses("cliproxy/gemini-3.6-flash-high")

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["model"], "cliproxy/claude-opus-5")
        routing = body["metadata"]["chatmockModelRouting"]
        self.assertEqual(
            routing["requestedModel"], "cliproxy/gemini-3.6-flash-high"
        )
        self.assertEqual(routing["resolvedModel"], "cliproxy/claude-opus-5")
        self.assertEqual(routing["upstreamModel"], "claude-opus-5")
        self.assertTrue(routing["usedFallback"])
        self.assertEqual(response.headers["X-ChatMock-Failover"], "true")

    def test_cooldown_uses_the_upstream_reset_not_the_generic_default(self) -> None:
        """The proxy says exactly when the model returns. Falling back to the
        fifteen-minute default would bench a model that is free again in under a
        minute for the rest of the quarter hour."""
        self._configure(["gemini-3.6-flash-high", "claude-opus-5"])

        def respond(credentials, payload, upstream_model, *, stream):
            if upstream_model == "gemini-3.6-flash-high":
                return FakeResponse(status_code=429, body=self.COOLDOWN_BODY)
            return FakeResponse(body={"choices": [{"message": {"content": "ok"}}]})

        with (
            patch.object(openai_compatible, "request_chat", side_effect=respond),
            patch.object(claude_code, "request_chat", side_effect=respond),
        ):
            self._ask("cliproxy/gemini-3.6-flash-high")

        cooldown = failover.cooldown_for("cliproxy/gemini-3.6-flash-high")
        self.assertIsNotNone(cooldown)
        self.assertLessEqual(cooldown.remaining_seconds, 52)
        self.assertGreater(cooldown.remaining_seconds, 30)

    def test_last_resort_message_carries_no_internal_routing_nouns(self) -> None:
        """With no stand-in left the client does see the refusal, so it has to
        read as an explanation rather than as proxy internals."""
        self._configure(["gemini-3.6-flash-high"])

        with patch.object(
            openai_compatible,
            "request_chat",
            return_value=FakeResponse(status_code=429, body=self.COOLDOWN_BODY),
        ):
            response = self._ask("cliproxy/gemini-3.6-flash-high")

        self.assertEqual(response.status_code, 429)
        message = response.get_json()["error"]["message"]
        self.assertNotIn("antigravity", message)
        self.assertNotIn("credentials", message)
        self.assertIn("cliproxy/gemini-3.6-flash-high", message)
        self.assertIn("52 seconds", message)

    def test_a_real_error_is_not_mistaken_for_exhaustion(self) -> None:
        """A malformed request must reach the client unchanged: retrying it on a
        different model would hide the thing the caller has to fix."""
        self._configure(["gemini-3.6-flash-high", "claude-opus-5"])
        calls: list[str] = []

        def respond(credentials, payload, upstream_model, *, stream):
            calls.append(upstream_model)
            return FakeResponse(
                status_code=400,
                body={"error": {"message": "tools.0.input_schema: Field required"}},
            )

        with patch.object(openai_compatible, "request_chat", side_effect=respond):
            response = self._ask("cliproxy/gemini-3.6-flash-high")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(calls, ["gemini-3.6-flash-high"])
        self.assertFalse(failover.is_cooling("cliproxy/gemini-3.6-flash-high"))


class ProviderErrorTextTests(unittest.TestCase):
    """What a failed upstream call says to the person reading it.

    Clients render a failed turn's message as the assistant's answer, so these
    strings are UI, not logs.
    """

    def test_upstream_explanation_is_returned_alone(self) -> None:
        # The upstream wrote this for the user ("Add more at …"); wrapping it in
        # routing trivia buries the only actionable part.
        message = (
            "Third-party apps now draw from your extra usage, not your plan "
            "limits. Add more at claude.ai/settings/usage and keep going."
        )
        response = FakeResponse(status_code=400, body={"error": {"message": message}})
        self.assertEqual(transport.error_message(response, "cliproxy"), message)

    def test_internal_route_ids_never_appear(self) -> None:
        # `cliproxy` is Breadboard's own subscription proxy — a name the reader
        # has never seen and cannot act on.
        for provider_id in ("cliproxy", "chatmock", "unknown-provider"):
            text = transport.error_message(FakeResponse(status_code=503), provider_id)
            self.assertNotIn("cliproxy", text.lower())
            self.assertNotIn("chatmock", text.lower())

    def test_status_only_failures_name_the_provider_readably(self) -> None:
        self.assertEqual(
            transport.error_message(FakeResponse(status_code=503), "cliproxy"),
            "Subscriptions returned HTTP 503.",
        )
        self.assertEqual(
            transport.error_message(FakeResponse(status_code=529), "anthropic"),
            "Anthropic returned HTTP 529.",
        )
        self.assertEqual(transport.provider_label("nope"), "The model provider")

    def test_oversized_bodies_are_still_reduced_to_a_status(self) -> None:
        # Long bodies can carry keys, tokens and internal URLs.
        response = FakeResponse(status_code=400, body={"error": {"message": "x" * 400}})
        self.assertEqual(
            transport.error_message(response, "openrouter"),
            "OpenRouter returned HTTP 400.",
        )


def _spec(provider_id: str):
    from chatmock.providers.catalog import provider_spec

    spec = provider_spec(provider_id)
    assert spec is not None
    return spec


def _entry(provider_id: str) -> dict:
    return next(entry for entry in store.public_state() if entry["id"] == provider_id)


if __name__ == "__main__":
    unittest.main()
