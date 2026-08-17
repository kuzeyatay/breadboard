from __future__ import annotations

import base64
import json
import os
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from chatmock.providers import claude_code, dispatch, openai_compatible, pxpipe
from chatmock.providers.catalog import provider_spec
from chatmock.providers.registry import resolve_model
from chatmock.providers.store import ResolvedCredentials
from chatmock.providers.types import ProviderError


def _credentials() -> ResolvedCredentials:
    return ResolvedCredentials(
        provider_id="cliproxy",
        api_key="loopback",
        base_url="http://127.0.0.1:8317/v1",
        usable=True,
        reason=None,
    )


def _cli_body(*, content: str = "ok", tool_calls=None):
    return {
        "is_error": False,
        "structured_output": {
            "content": content,
            "tool_calls": tool_calls or [],
        },
        "usage": {
            "input_tokens": 5,
            "cache_read_input_tokens": 7,
            "cache_creation_input_tokens": 11,
            "output_tokens": 13,
        },
    }


class ClaudeCodeBridgeTests(unittest.TestCase):
    def test_only_claude_subscription_models_are_intercepted(self) -> None:
        self.assertTrue(claude_code.is_claude_model("claude-sonnet-5"))
        self.assertTrue(claude_code.is_claude_model("cliproxy/claude-opus-5"))
        self.assertFalse(claude_code.is_claude_model("gemini-3-pro"))

        cliproxy = provider_spec("cliproxy")
        self.assertIsNotNone(cliproxy)
        self.assertIs(dispatch._client_for_model(cliproxy, "claude-sonnet-5"), claude_code)
        self.assertIsNot(dispatch._client_for_model(cliproxy, "gemini-3-pro"), claude_code)

    def test_tool_choice_is_encoded_in_the_structured_schema(self) -> None:
        tools = [
            {
                "name": "weather",
                "description": "Weather",
                "parameters": {"type": "object"},
            }
        ]
        forbidden = claude_code._output_schema({"tool_choice": "none"}, tools)
        self.assertEqual(forbidden["properties"]["tool_calls"]["maxItems"], 0)

        required = claude_code._output_schema({"tool_choice": "required"}, tools)
        self.assertEqual(required["properties"]["tool_calls"]["minItems"], 1)
        self.assertEqual(
            required["properties"]["tool_calls"]["items"]["properties"]["name"]["enum"],
            ["weather"],
        )

    def test_non_streaming_response_translates_text_tools_and_usage(self) -> None:
        body = _cli_body(
            content="Checking.",
            tool_calls=[{"name": "weather", "arguments": {"city": "Eindhoven"}}],
        )
        with patch.object(claude_code, "_run_cli", return_value=body):
            response = claude_code.request_chat(
                _credentials(),
                {
                    "messages": [{"role": "user", "content": "Weather?"}],
                    "tools": [
                        {
                            "type": "function",
                            "function": {
                                "name": "weather",
                                "parameters": {"type": "object"},
                            },
                        }
                    ],
                },
                "claude-sonnet-5",
                stream=False,
            )
        completion = response.json()
        choice = completion["choices"][0]
        self.assertEqual(choice["finish_reason"], "tool_calls")
        self.assertEqual(choice["message"]["tool_calls"][0]["function"]["name"], "weather")
        self.assertEqual(
            json.loads(choice["message"]["tool_calls"][0]["function"]["arguments"]),
            {"city": "Eindhoven"},
        )
        self.assertEqual(completion["usage"]["prompt_tokens"], 23)
        self.assertEqual(completion["usage"]["total_tokens"], 36)

    def test_stream_is_valid_openai_sse_and_finishes(self) -> None:
        with patch.object(claude_code, "_run_cli", return_value=_cli_body(content="hello")):
            response = claude_code.request_chat(
                _credentials(),
                {
                    "messages": [{"role": "user", "content": "Hi"}],
                    "stream_options": {"include_usage": True},
                },
                "claude-sonnet-5",
                stream=True,
            )
        text = b"".join(openai_compatible.relay_stream(response)).decode("utf-8")
        self.assertIn('"content":"hello"', text)
        self.assertIn('"usage":', text)
        self.assertTrue(text.endswith("data: [DONE]\n\n"))

    def test_cli_is_constrained_and_receives_the_conversation_on_stdin(self) -> None:
        captured = {}

        def fake_run(command, **kwargs):
            captured["command"] = command
            captured["input"] = kwargs["input"]
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps(_cli_body(content="safe")),
                stderr="",
            )

        with (
            patch.object(claude_code, "_claude_executable", return_value="claude"),
            patch.object(subprocess, "run", side_effect=fake_run),
        ):
            result = claude_code._run_cli(
                {
                    "messages": [{"role": "user", "content": "hello"}],
                    "reasoning_effort": "high",
                },
                "claude-sonnet-5",
            )

        self.assertEqual(result["structured_output"]["content"], "safe")
        command = captured["command"]
        self.assertIn("--no-session-persistence", command)
        self.assertEqual(command[command.index("--tools") + 1], "")
        self.assertEqual(command[command.index("--setting-sources") + 1], "")
        self.assertEqual(command[command.index("--effort") + 1], "high")
        self.assertEqual(json.loads(captured["input"]), [{"role": "user", "content": "hello"}])

    def test_one_call_outlasts_a_whole_generated_mini_app(self) -> None:
        # The in-chat visualizer asks for a complete three-file app as a single
        # structured tool argument. A replayed generation took 265s at default
        # effort, and real turns add `--effort high` and a far longer
        # conversation, so a budget near that measurement cuts finished work off
        # mid-answer — which is what the old 240s ceiling did.
        self.assertGreaterEqual(claude_code._request_timeout_seconds(), 480)
        # ...but it still has to lose to the OpenAI client's own ten-minute
        # default, or the caller reports a bare read timeout instead of the
        # explanation below.
        self.assertLess(claude_code._MAX_REQUEST_TIMEOUT_SECONDS, 600)

    def test_an_unfinished_call_reports_the_limit_it_hit(self) -> None:
        def fake_run(command, **kwargs):
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])

        with (
            patch.object(claude_code, "_claude_executable", return_value="claude"),
            patch.object(subprocess, "run", side_effect=fake_run),
            patch.dict("os.environ", {"CHATMOCK_CLAUDE_CODE_TIMEOUT_SECONDS": "300"}),
        ):
            with self.assertRaises(claude_code.ProviderError) as caught:
                claude_code._run_cli({"messages": []}, "claude-sonnet-5")

        # The message is the assistant's answer, so it must say what the limit
        # was rather than leave "timed out" to be read as a dead end.
        self.assertIn("300 seconds", str(caught.exception))

    def test_the_timeout_override_is_clamped_to_a_usable_range(self) -> None:
        for value, expected in (
            ("900", claude_code._MAX_REQUEST_TIMEOUT_SECONDS),
            ("1", claude_code._MIN_REQUEST_TIMEOUT_SECONDS),
            ("not-a-number", claude_code._DEFAULT_REQUEST_TIMEOUT_SECONDS),
            ("360", 360),
        ):
            with patch.dict(
                "os.environ", {"CHATMOCK_CLAUDE_CODE_TIMEOUT_SECONDS": value}
            ):
                self.assertEqual(claude_code._request_timeout_seconds(), expected)

    def test_image_parts_become_readable_files_for_the_cli(self) -> None:
        # The conversation reaches the CLI as stdin prompt text, so an inline
        # data URL arrives as tens of thousands of base64 tokens the model can
        # only describe, never see. The bridge must deliver pixels as files the
        # CLI's Read tool renders natively.
        png = b"\x89PNG\r\n\x1a\nnot-a-real-image"
        data_url = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
        payload = {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "What color is this?"},
                        {"type": "image_url", "image_url": {"url": data_url}},
                        {
                            "type": "image_url",
                            "image_url": {"url": "https://example.test/a.png"},
                        },
                    ],
                }
            ]
        }
        captured = {}

        def fake_run(command, **kwargs):
            captured["command"] = command
            captured["input"] = kwargs["input"]
            cwd = Path(kwargs["cwd"])
            captured["files"] = {p.name: p.read_bytes() for p in cwd.glob("attachment-*")}
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps(_cli_body(content="Red")),
                stderr="",
            )

        with (
            patch.object(claude_code, "_claude_executable", return_value="claude"),
            patch.object(subprocess, "run", side_effect=fake_run),
        ):
            claude_code._run_cli(payload, "claude-sonnet-5")

        command = captured["command"]
        self.assertEqual(command[command.index("--tools") + 1], "Read")
        self.assertEqual(command[command.index("--max-turns") + 1], "6")
        # The decoded pixels were on disk for the CLI's Read tool at run time...
        self.assertEqual(captured["files"], {"attachment-1.png": png})
        # ...and the stdin conversation carries pointers, never base64.
        parts = json.loads(captured["input"])[0]["content"]
        self.assertTrue(all(part["type"] == "text" for part in parts))
        self.assertIn("attachment-1.png", parts[1]["text"])
        self.assertIn("Read tool", parts[1]["text"])
        self.assertIn("https://example.test/a.png", parts[2]["text"])
        self.assertNotIn(data_url, captured["input"])
        # Copy-on-write: dispatch's failover chain reuses this payload, so the
        # original image parts must survive for non-CLI substitute models.
        self.assertEqual(
            payload["messages"][0]["content"][1]["image_url"]["url"], data_url
        )

    def test_the_conversation_envelope_is_never_answered_as_user_speech(self) -> None:
        # The CLI takes the whole conversation as prompt text, so the JSON
        # envelope is visible to the model as if the user had typed it. Without
        # these rules a plain greeting came back with an unrequested note about
        # runtime metadata and routing aliases.
        prompt = claude_code._system_prompt({"tool_choice": "auto"}, [])
        self.assertIn("transport scaffolding", prompt)
        self.assertIn("never describe, quote, correct, or remark on it", prompt)
        self.assertIn("They are not user speech", prompt)
        self.assertIn("Answer only what the newest user message actually asks", prompt)
        self.assertIn("routing aliases", prompt)

    def test_dispatch_resolves_the_public_subscription_id(self) -> None:
        resolved = resolve_model("cliproxy/claude-sonnet-5")
        self.assertEqual(resolved.upstream_model, "claude-sonnet-5")
        self.assertIs(dispatch._client_for_model(resolved.provider, resolved.upstream_model), claude_code)

    def _run_with_fake_cli(self, model: str, base_url):
        """Run one CLI call with the subprocess and the proxy both stubbed."""
        captured = {}

        def fake_run(command, **kwargs):
            captured["command"] = command
            captured["env"] = kwargs["env"]
            return SimpleNamespace(
                returncode=0, stdout=json.dumps(_cli_body()), stderr=""
            )

        with (
            patch.object(claude_code, "_claude_executable", return_value="claude"),
            patch.object(subprocess, "run", side_effect=fake_run),
            patch.object(pxpipe, "base_url", side_effect=base_url) as proxy,
        ):
            claude_code._run_cli({"messages": [{"role": "user", "content": "hi"}]}, model)
        return captured, proxy

    def test_the_efficient_route_asks_the_cli_for_fable_through_the_proxy(self) -> None:
        # `-efficient` is Breadboard's name for the route, and the CLI would
        # reject it as a model. What reaches Anthropic is plain Fable 5; the only
        # difference is the loopback proxy that images the bulk on the way.
        captured, proxy = self._run_with_fake_cli(
            "claude-fable-5-efficient", lambda: "http://127.0.0.1:47821"
        )
        command = captured["command"]
        self.assertEqual(command[command.index("--model") + 1], "claude-fable-5")
        self.assertEqual(captured["env"]["ANTHROPIC_BASE_URL"], "http://127.0.0.1:47821")
        proxy.assert_called_once()

    def test_the_plain_model_never_touches_the_proxy(self) -> None:
        # Imaging is lossy for long exact strings in old context, so the plain id
        # has to stay a way to reach Fable with none of it — including when the
        # proxy happens to be running for the other model.
        captured, proxy = self._run_with_fake_cli("claude-fable-5", lambda: "unused")
        command = captured["command"]
        self.assertEqual(command[command.index("--model") + 1], "claude-fable-5")
        self.assertEqual(
            captured["env"].get("ANTHROPIC_BASE_URL"),
            os.environ.get("ANTHROPIC_BASE_URL"),
        )
        proxy.assert_not_called()

    def test_a_proxy_that_cannot_start_is_the_answer_rather_than_a_wrong_one(self) -> None:
        # Falling back to the direct route would silently bill full price for a
        # model chosen to avoid it, so the refusal is reported instead.
        with self.assertRaises(ProviderError) as raised:
            self._run_with_fake_cli(
                "claude-fable-5-efficient",
                lambda: (_ for _ in ()).throw(ProviderError("proxy down")),
            )
        self.assertIn("proxy down", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
