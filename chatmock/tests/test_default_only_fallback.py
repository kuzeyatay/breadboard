from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from chatmock.app import create_app
from chatmock import failover
from chatmock.council.policy import CouncilConfig
from chatmock.providers import openai_compatible, store
from chatmock.providers.registry import default_fallback
from chatmock.providers.router import ProviderRouter
from chatmock.providers.types import ModelCall, ProviderError
from tests.test_providers import FakeResponse as ProviderResponse


class FakeResponse(ProviderResponse):
    @property
    def content(self):
        return json.dumps(self._body).encode()

    @property
    def text(self):
        return self.content.decode()

    @property
    def headers(self):
        return {}

    def iter_content(self, *args, **kwargs):
        yield self.content


class DefaultOnlyFallbackTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        env = patch.dict(os.environ, {
            "CHATMOCK_PROVIDERS_FILE": str(Path(temp.name) / "providers.json"),
            "CHATMOCK_FAILOVER_FILE": str(Path(temp.name) / "cooldowns.json"),
            "CHATMOCK_MODEL_TELEMETRY_FILE": str(Path(temp.name) / "attempts.jsonl"),
            "CHATMOCK_USAGE_LEDGER_FILE": str(Path(temp.name) / "usage.jsonl"),
            "CHATMOCK_MODEL_DISCOVERY": "0",
            "CHATMOCK_DEFAULT_MODEL": "",
        })
        env.start()
        self.addCleanup(env.stop)
        for provider in ("google", "openai", "openrouter"):
            store.upsert_provider(provider, api_key="test-key")
        self.primary = "google/gemini-test"
        self.default = "openai/default-test"
        store.set_default_model(self.default)
        self.client = create_app().test_client()
        self.calls = []
        # No regression test may reach a live provider.
        network = patch("requests.post", side_effect=AssertionError("Unexpected live request"))
        network.start()
        self.addCleanup(network.stop)

    def ask(self, endpoint="/v1/chat/completions", **overrides):
        payload = {
            "model": self.primary,
            "messages": [{"role": "user", "content": "hello"}],
            "tools": [{"type": "function", "function": {"name": "noop"}}],
        }
        if endpoint == "/v1/responses":
            payload.pop("messages")
            payload["input"] = "hello"
            payload["tools"] = [{"type": "function", "name": "noop", "parameters": {"type": "object"}}]
        elif endpoint == "/v1/completions":
            payload["prompt"] = "hello"
        payload.update(overrides)
        return self.client.post(endpoint, json=payload)

    def reject(self, credentials, payload, model, **kwargs):
        self.calls.append(f"{credentials.provider_id}/{model}")
        return FakeResponse(status_code=402 if model == "default-test" else 503,
                            body={"error": {"message": f"{model} rejected"}})

    def test_every_http_api_stops_after_the_default_fails(self):
        for endpoint in ("/v1/chat/completions", "/v1/responses", "/v1/completions"):
            with self.subTest(endpoint=endpoint):
                self.calls.clear()
                with patch.object(openai_compatible, "request_chat", side_effect=self.reject):
                    response = self.ask(endpoint)
                self.assertEqual(response.status_code, 402)
                self.assertEqual(response.headers["x-should-retry"], "false")
                self.assertEqual(self.calls, [self.primary, self.default])
                self.assertIn("default-test rejected", response.get_json()["error"]["message"])

    def test_selected_model_only_requests_never_try_the_profile_default(self):
        for endpoint in ("/v1/chat/completions", "/v1/responses", "/v1/completions"):
            with self.subTest(endpoint=endpoint):
                self.calls.clear()
                def reject_selected(credentials, payload, model, **kwargs):
                    self.assertNotIn("allow_model_fallback", payload)
                    return self.reject(credentials, payload, model, **kwargs)
                with patch.object(openai_compatible, "request_chat", side_effect=reject_selected):
                    response = self.ask(endpoint, allow_model_fallback=False)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(self.calls, [self.primary])
                self.assertNotEqual(response.headers.get("X-ChatMock-Failover"), "true")
                self.assertEqual(response.headers["x-should-retry"], "false")

    def test_invalid_fallback_policy_is_not_dispatched(self):
        with patch.object(openai_compatible, "request_chat") as request_chat:
            response = self.ask(allow_model_fallback="false")
        self.assertEqual(response.status_code, 400)
        request_chat.assert_not_called()

    def test_all_provider_rejections_go_directly_to_the_default(self):
        for status in (400, 401, 402, 403, 429, 500, 502, 503):
            with self.subTest(status=status):
                self.calls.clear()
                failover.clear_all()
                def respond(credentials, payload, model, **kwargs):
                    self.calls.append(f"{credentials.provider_id}/{model}")
                    if model == "gemini-test":
                        return FakeResponse(status_code=status, body={"error": {"message": "rejected"}})
                    return FakeResponse(body={"choices": [{"message": {"content": "answer"}}]})
                with patch.object(openai_compatible, "request_chat", side_effect=respond):
                    response = self.ask(stream=True)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.calls, [self.primary, self.default])
                self.assertEqual(response.headers["X-ChatMock-Requested-Model"], self.primary)
                self.assertEqual(response.headers["X-ChatMock-Failover"], "true")
                response.close()

    def test_failed_default_and_alias_do_not_start_another_attempt(self):
        for model in (self.default, "default"):
            with self.subTest(model=model):
                self.calls.clear()
                with patch.object(openai_compatible, "request_chat", side_effect=self.reject):
                    response = self.ask(model=model)
                self.assertEqual(response.status_code, 402)
                self.assertEqual(self.calls, [self.default])
        store.set_default_model("gpt-5.6-luna")
        self.assertIsNone(default_fallback("chatgpt/gpt-5.6-luna"))

    def test_disabled_default_does_not_discover_another_provider(self):
        store.set_default_model("none")
        with patch.object(openai_compatible, "request_chat", side_effect=self.reject):
            response = self.ask()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.calls, [self.primary])

    def test_chatgpt_default_is_reachable_from_tool_requests_and_its_failure_is_final(self):
        store.set_default_model("gpt-5.6-luna")
        def reject_chatgpt(model, *args, **kwargs):
            self.calls.append(model)
            return FakeResponse(status_code=402, body={"error": {"message": "default failed"}}), None
        with (patch.object(openai_compatible, "request_chat", side_effect=self.reject),
              patch("chatmock.routes_openai.start_upstream_request", side_effect=reject_chatgpt)):
            response = self.ask()
        self.assertEqual(response.status_code, 402)
        self.assertEqual(self.calls, [self.primary, "gpt-5.6-luna"])

    def test_chatgpt_request_can_fall_back_to_the_configured_external_default(self):
        with (patch("chatmock.routes_openai.start_upstream_request", return_value=(
                FakeResponse(status_code=503, body={"error": {"message": "selected failed"}}), None)),
              patch.object(openai_compatible, "request_chat", side_effect=self.reject)):
            response = self.ask(model="gpt-5.6-luna")
        self.assertEqual(response.status_code, 402)
        self.assertEqual(self.calls, [self.default])

    def test_council_stops_at_the_default_for_any_rejection(self):
        for status in (400, 401, 402, 429, 503):
            with self.subTest(status=status):
                self.calls.clear()
                def reject(call, resolved):
                    self.calls.append(resolved.public_model)
                    raise ProviderError(f"{resolved.public_model} failed", status_code=status, replay_safe=True)
                router = ProviderRouter(CouncilConfig(upstream_fallback_model="openrouter/forbidden"))
                with patch.object(router, "_invoke", side_effect=reject):
                    with self.assertRaisesRegex(ProviderError, self.default):
                        router.call_model(ModelCall(model=self.primary, messages=[]))
                self.assertEqual(self.calls, [self.primary, self.default])

    def test_ambiguous_transport_failure_is_not_replayed(self):
        with patch.object(openai_compatible, "request_chat", side_effect=ProviderError("lost response", phase="receive")) as call:
            response = self.ask()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(call.call_count, 1)

    def test_strict_request_never_falls_back(self):
        with patch.object(openai_compatible, "request_chat", side_effect=self.reject):
            response = self.ask(learnStrictRoute=True)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.calls, [self.primary])


if __name__ == "__main__":
    unittest.main()
