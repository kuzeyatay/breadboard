from __future__ import annotations

"""Does unslop actually reach every model, and every request?

Two separate questions, answered separately:

  * Model coverage — the skill is appended to the final-answer *system* string
    inside the council, so it is model-independent by construction. These tests
    prove it for every provider in the catalog and prove each provider family's
    transport really puts that system text on the wire.

  * Request coverage — the council (and therefore unslop) declines any request
    that carries tools. Hermes sends its Breadboard toolset on every turn, so
    the Terminal/Garden/Quartz surfaces never reach it. That gap is asserted
    here so it stays visible rather than being assumed fixed.
"""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import os

from chatmock.council.gateway import council_bypass_reason
from chatmock.council.ledger import JsonlCouncilLedger
from chatmock.council.policy import CouncilConfig
from chatmock.council.runtime import CouncilRuntime
from chatmock.council.types import CouncilInput
from chatmock.council.unslop import (
    BREADBOARD_UI_SYSTEM_MARKER,
    maybe_unslop_instructions,
    maybe_unslop_messages,
)
from chatmock.providers import anthropic, claude_code, openai_compatible
from chatmock.providers.catalog import iter_provider_specs
from chatmock.providers.store import ResolvedCredentials
from chatmock.providers.types import ModelCall

MARKER = "UNSLOP_SKILL_MARKER"


class _CapturingRouter:
    """Duck-typed ProviderRouter that records every ModelCall."""

    def __init__(self) -> None:
        self.calls: list[ModelCall] = []

    def effective_model(self, model: str) -> str:
        return model

    def call_model(self, call: ModelCall) -> str:
        self.calls.append(call)
        return "answer"


def _credentials(provider_id: str) -> ResolvedCredentials:
    return ResolvedCredentials(
        provider_id=provider_id,
        api_key="test-key",
        base_url="https://example.invalid/v1",
        usable=True,
        reason=None,
    )


class UnslopModelCoverageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.skill_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.skill_dir.cleanup)
        (Path(self.skill_dir.name) / "SKILL.md").write_text(
            f"# Unslop\n{MARKER}: remove the signs of AI writing.",
            encoding="utf-8",
        )
        (Path(self.skill_dir.name) / "references").mkdir()
        self._reset_cache()
        self._env = patch.dict(
            os.environ,
            {"ENABLE_UNSLOP": "true", "UNSLOP_SKILL_DIR": self.skill_dir.name},
        )
        self._env.start()
        self.addCleanup(self._env.stop)
        self.addCleanup(self._reset_cache)

    @staticmethod
    def _reset_cache() -> None:
        from chatmock.council import unslop as unslop_module

        unslop_module._cached_directive = None
        unslop_module._cache_key = None

    def _answer_with(self, model: str) -> ModelCall:
        router = _CapturingRouter()
        runtime = CouncilRuntime(
            config=CouncilConfig(council_models=[model], chairman_model=model),
            router=router,
            ledger=JsonlCouncilLedger(self.tmp.name),
        )
        runtime.run(
            CouncilInput(
                messages=[{"role": "user", "content": "explain entropy"}],
                requested_model=model,
            )
        )
        self.assertEqual(len(router.calls), 1, f"{model}: expected one final call")
        return router.calls[0]

    def test_the_skill_is_attached_for_a_model_from_every_provider(self) -> None:
        # One representative model per catalog provider, plus the bare ChatGPT
        # default that carries no provider prefix.
        models = ["gpt-5.1"]
        for spec in iter_provider_specs():
            suggested = getattr(spec, "suggested_models", ()) or ()
            if suggested:
                models.append(f"{spec.id}/{suggested[0]}")
        self.assertGreater(len(models), 5, "catalog produced too few models to be a real sweep")

        for model in models:
            with self.subTest(model=model):
                call = self._answer_with(model)
                self.assertIn(MARKER, call.system or "", f"{model} lost the unslop skill")

    def test_claude_subscription_models_are_covered_too(self) -> None:
        call = self._answer_with("cliproxy/claude-opus-5")
        self.assertIn(MARKER, call.system or "")


class UnslopTransportCoverageTests(unittest.TestCase):
    """Each provider family must put the unslopped system text on the wire."""

    def _call(self, system: str) -> ModelCall:
        return ModelCall(
            model="test-model",
            messages=[{"role": "user", "content": "hi"}],
            system=system,
        )

    def test_openai_compatible_sends_it_as_a_system_message(self) -> None:
        captured: dict = {}

        def fake_request(credentials, payload, upstream_model, *, stream):
            captured["payload"] = payload
            return SimpleNamespace(
                status_code=200,
                json=lambda: {"choices": [{"message": {"content": "ok"}}]},
            )

        with patch.object(openai_compatible, "request_chat", side_effect=fake_request):
            openai_compatible.call_model(
                self._call(f"policy\n{MARKER}"), _credentials("openrouter"), "test-model"
            )
        systems = [
            m for m in captured["payload"]["messages"] if m.get("role") == "system"
        ]
        self.assertTrue(systems)
        self.assertIn(MARKER, systems[0]["content"])

    def test_anthropic_sends_it_as_a_system_message(self) -> None:
        captured: dict = {}

        def fake_request(credentials, payload, upstream_model, *, stream):
            captured["payload"] = payload
            return SimpleNamespace(
                status_code=200,
                json=lambda: {"choices": [{"message": {"content": "ok"}}]},
            )

        with patch.object(anthropic, "request_chat", side_effect=fake_request):
            anthropic.call_model(
                self._call(f"policy\n{MARKER}"), _credentials("anthropic"), "claude-x"
            )
        systems = [
            m for m in captured["payload"]["messages"] if m.get("role") == "system"
        ]
        self.assertTrue(systems)
        self.assertIn(MARKER, systems[0]["content"])

    def test_claude_code_sends_it_in_the_conversation_on_stdin(self) -> None:
        captured: dict = {}

        def fake_run(command, **kwargs):
            captured["input"] = kwargs["input"]
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps(
                    {
                        "is_error": False,
                        "structured_output": {"content": "ok", "tool_calls": []},
                    }
                ),
                stderr="",
            )

        with (
            patch.object(claude_code, "_claude_executable", return_value="claude"),
            patch.object(subprocess, "run", side_effect=fake_run),
        ):
            claude_code.call_model(
                self._call(f"policy\n{MARKER}"), _credentials("cliproxy"), "claude-opus-5"
            )
        messages = json.loads(captured["input"])
        systems = [m for m in messages if m.get("role") == "system"]
        self.assertTrue(systems)
        self.assertIn(MARKER, systems[0]["content"])


class UnslopRequestCoverageTests(unittest.TestCase):
    """Tool-carrying requests never reach the council, so the passthrough has to
    attach the skill itself."""

    def setUp(self) -> None:
        self.skill_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.skill_dir.cleanup)
        (Path(self.skill_dir.name) / "SKILL.md").write_text(
            f"# Unslop\n{MARKER}", encoding="utf-8"
        )
        (Path(self.skill_dir.name) / "references").mkdir()
        UnslopModelCoverageTests._reset_cache()
        self._env = patch.dict(
            os.environ,
            {"ENABLE_UNSLOP": "true", "UNSLOP_SKILL_DIR": self.skill_dir.name},
        )
        self._env.start()
        self.addCleanup(self._env.stop)
        self.addCleanup(UnslopModelCoverageTests._reset_cache)

    @staticmethod
    def _hermes_turn(**payload):
        messages = [
            {
                "role": "system",
                "content": f"{BREADBOARD_UI_SYSTEM_MARKER} Use only the Breadboard tools.",
            },
            {"role": "user", "content": "what's my name?"},
        ]
        request = {
            "tools": [{"type": "function", "function": {"name": "garden_search"}}],
            **payload,
        }
        return messages, request

    def test_a_tool_carrying_turn_bypasses_the_council_entirely(self) -> None:
        messages, payload = self._hermes_turn()
        self.assertEqual(
            council_bypass_reason(payload, messages), "function/tool calling request"
        )

    def test_a_plain_chat_turn_still_reaches_the_council(self) -> None:
        self.assertIsNone(council_bypass_reason({}, [{"role": "user", "content": "hi"}]))

    def test_the_bypassed_hermes_turn_still_gets_the_skill(self) -> None:
        messages, payload = self._hermes_turn()
        updated = maybe_unslop_messages(messages, payload)
        self.assertIsNot(updated, messages)
        self.assertIn(MARKER, updated[0]["content"])
        # The user turn and the caller's list are untouched.
        self.assertEqual(updated[1], messages[1])
        self.assertNotIn(MARKER, messages[0]["content"])

    def test_it_is_attached_once_even_if_the_turn_is_processed_twice(self) -> None:
        messages, payload = self._hermes_turn()
        once = maybe_unslop_messages(messages, payload)
        twice = maybe_unslop_messages(once, payload)
        self.assertIs(twice, once)

    def test_non_breadboard_callers_are_left_alone(self) -> None:
        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "hi"},
        ]
        self.assertIs(maybe_unslop_messages(messages, {"tools": [{}]}), messages)

    def test_machine_readable_turns_are_left_alone(self) -> None:
        messages, forced = self._hermes_turn(
            tool_choice={"type": "function", "function": {"name": "emit"}}
        )
        self.assertIs(maybe_unslop_messages(messages, forced), messages)

        messages, schema = self._hermes_turn(
            response_format={"type": "json_schema", "json_schema": {"name": "x"}}
        )
        self.assertIs(maybe_unslop_messages(messages, schema), messages)

        messages, structured = self._hermes_turn(task_type="source_map")
        self.assertIs(maybe_unslop_messages(messages, structured), messages)

    def test_the_responses_passthrough_is_covered_too(self) -> None:
        instructions = f"{BREADBOARD_UI_SYSTEM_MARKER} Answer from the garden."
        updated = maybe_unslop_instructions(instructions, {"tools": [{}]})
        self.assertIn(MARKER, updated)
        self.assertIs(
            maybe_unslop_instructions("You are someone else.", {"tools": [{}]}),
            "You are someone else.",
        )

    def test_disabling_unslop_turns_the_passthrough_off(self) -> None:
        messages, payload = self._hermes_turn()
        with patch.dict(os.environ, {"ENABLE_UNSLOP": "false"}):
            UnslopModelCoverageTests._reset_cache()
            self.assertIs(maybe_unslop_messages(messages, payload), messages)


if __name__ == "__main__":
    unittest.main()
