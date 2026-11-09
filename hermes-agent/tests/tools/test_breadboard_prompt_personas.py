"""Account prompt transport without a model call, real service or external package."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = next(parent for parent in ROOT.parents if (parent / "hermes-agent" / "toolsets.py").is_file())
sys.path.insert(0, str(REPOSITORY / "hermes-agent"))


class BreadboardPersonaTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location(
            "tools.agency_personas", ROOT / "tools" / "agency_personas.py"
        )
        self.personas = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.personas)
        self.calls = []
        self.responses = {"session-a": "FIRST A", "session-b": "ONLY B"}
        self.plugin = types.ModuleType("plugins.breadboard")

        def request(args, **kwargs):
            self.calls.append((args, kwargs))
            return json.dumps({"persona": self.responses[kwargs["task_id"]]})

        self.plugin._call_breadboard = request
        self.modules = patch.dict(sys.modules, {
            "tools.agency_personas": self.personas,
            "plugins.breadboard": self.plugin,
        })
        self.modules.start()
        self.environment = patch.dict(os.environ, {"BREADBOARD_HERMES_TOOL_SECRET": "test-secret"})
        self.environment.start()
        self.home = tempfile.TemporaryDirectory(prefix=".persona-home-", dir=ROOT)
        self.home_environment = patch.dict(os.environ, {"HERMES_HOME": self.home.name})
        self.home_environment.start()
        spec = importlib.util.spec_from_file_location("tools.delegate_tool", ROOT / "tools" / "delegate_tool.py")
        self.delegate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.delegate)

    def tearDown(self):
        self.home_environment.stop()
        self.home.cleanup()
        self.environment.stop()
        self.modules.stop()

    def child_prompt(self):
        return self.delegate._build_child_system_prompt

    def test_each_delegation_reads_its_current_session_persona(self):
        read = self.personas.render_persona_block
        self.assertEqual(read("Frontend-Developer", task_id="session-a"), "FIRST A")
        self.responses["session-a"] = "SECOND A"
        self.assertEqual(read("frontend-developer", task_id="session-b"), "ONLY B")
        self.assertEqual(read("frontend-developer", task_id="session-a"), "SECOND A")
        self.responses["session-a"] = ""
        self.assertEqual(read("frontend-developer", task_id="session-a"), "")
        self.responses["session-a"] = None
        self.assertIsNone(read("unknown", task_id="session-a"))
        self.assertEqual(self.calls[0][0], {"slug": "frontend-developer"})
        self.assertEqual(self.calls[0][1]["route"], "/api/hermes/tools/system-prompts")
        self.assertEqual(self.calls[0][1]["tool_name"], "system_prompt_persona")

    def test_child_prompt_passes_parent_identity_and_does_not_hide_transport_errors(self):
        build = self.child_prompt()
        output = build("[persona: frontend-developer] Explain a circuit", parent_task_id="session-b")
        self.assertIn("ONLY B", output)
        self.assertIn("Explain a circuit", output)
        self.assertNotIn("[persona:", output)
        self.plugin._call_breadboard = lambda *args, **kwargs: '{"error":"session unavailable"}'
        with self.assertRaises(self.personas.BreadboardPersonaError):
            build("[persona: frontend-developer] Explain a circuit", parent_task_id="session-a")

    def test_standalone_hermes_preserves_file_personas(self):
        with tempfile.TemporaryDirectory(prefix=".persona-test-", dir=ROOT) as temporary:
            self.assertTrue(Path(temporary).resolve().is_relative_to(ROOT.resolve()))
            division = Path(temporary) / "engineering"
            division.mkdir()
            (division / "engineering-frontend-developer.md").write_text(
                "---\nname: Frontend developer\n---\nOriginal local guidance.", encoding="utf-8"
            )
            with patch.dict(os.environ, {"AGENCY_AGENTS_PATH": temporary, "BREADBOARD_HERMES_TOOL_SECRET": ""}):
                result = self.personas.render_persona_block("frontend-developer", task_id="standalone")
                self.assertIn("Original local guidance.", result)
                self.assertEqual(self.calls, [])

    def test_spawn_passes_the_actual_parent_session_to_prompt_composition(self):
        class Composed(Exception):
            pass
        original = self.child_prompt()
        captured = []
        def compose(*args, **kwargs):
            captured.append(original(*args, **kwargs))
            raise Composed()
        runtime = types.ModuleType("run_agent")
        runtime.AIAgent = object
        parent = types.SimpleNamespace(session_id="session-b", enabled_toolsets=[])
        with patch.dict(sys.modules, {"run_agent": runtime}), \
             patch.object(self.delegate, "_load_config", return_value={}), \
             patch.object(self.delegate, "_build_child_system_prompt", side_effect=compose):
            with self.assertRaises(Composed):
                self.delegate._build_child_agent(0, "[persona: frontend-developer] Explain", None, [], None, 1, 1, parent)
        self.assertIn("ONLY B", captured[0])
        self.assertEqual(self.calls[-1][1]["task_id"], "session-b")


if __name__ == "__main__":
    unittest.main()
