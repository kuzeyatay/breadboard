from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest

from _cli_harness import run_cli
from omh.routing import recommend as recommend_module
from omh.skill_pack import builtin_definitions, builtin_harnesses
from omh.wrapper.contract import VISIBLE_ACTIONS, build_chat_interaction_payload
from omh.workflows.plugin_risk_audit import audit_plugin_risk

from _platform_support import requires_secure_dir_io


class PluginRiskAuditTests(unittest.TestCase):
    @requires_secure_dir_io
    def test_audit_reports_static_risk_categories_without_exposing_plugin_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "plugin.json").write_text('{"name": "example"}\n', encoding="utf-8")
            (root / "pyproject.toml").write_text('dependencies = ["requests>=2"]\n', encoding="utf-8")
            source_marker = "PRIVATE_AUDIT_SOURCE_MARKER"
            (root / "plugin.py").write_text(
                "import requests\n"
                "import subprocess\n"
                "def hook() -> None:\n"
                "    subprocess.run(['tool'], check=False)\n"
                "    eval('1 + 1')\n"
                "    requests.get('https://example.invalid')\n"
                "    pre_tool_call = True\n"
                "    api_key = 'sk_abcdefghijk1234567890'\n"
                f"    marker = '{source_marker}'\n",
                encoding="utf-8",
            )

            payload = audit_plugin_risk(root)

        self.assertEqual(payload["schema_version"], "plugin_risk_audit/v1")
        self.assertTrue(payload["source"]["explicit_root"])
        self.assertEqual(payload["source"]["manifest_status"], "present")
        self.assertEqual(payload["summary"]["scanned_file_count"], 3)
        self.assertEqual(
            payload["summary"]["risk_categories"],
            [
                "declared_dependency",
                "dynamic_code_execution",
                "hermes_hook_capability",
                "network_request",
                "potential_committed_secret",
                "process_execution",
            ],
        )
        self.assertEqual(payload["not_observed"]["plugin_import"]["status"], "not_observed")
        self.assertEqual(payload["not_observed"]["plugin_execution"]["status"], "not_observed")
        self.assertNotIn(source_marker, json.dumps(payload))
        self.assertNotIn(str(root), json.dumps(payload))

    @requires_secure_dir_io
    def test_audit_rejects_non_directory_and_symlinked_plugin_sources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / "plugin.py"
            source.write_text("pass\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "directory"):
                audit_plugin_risk(source)

            nested = root / "plugin"
            nested.mkdir()
            (nested / "plugin.py").write_text("pass\n", encoding="utf-8")
            linked = nested / "linked.py"
            linked.symlink_to(source)

            with self.assertRaisesRegex(ValueError, "symlink"):
                audit_plugin_risk(nested)

            aliased_parent = root / "aliased-parent"
            aliased_parent.symlink_to(root, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symlink"):
                audit_plugin_risk(aliased_parent / "plugin")

    @requires_secure_dir_io
    def test_audit_classifies_javascript_plugins_and_package_dependencies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "plugin.json").write_text('{"name": "javascript-example"}\n', encoding="utf-8")
            (root / "package.json").write_text('{"dependencies": {"axios": "1.0.0"}}\n', encoding="utf-8")
            (root / "plugin.mjs").write_text(
                "child_process.exec('tool');\n"
                "new Function('return 1');\n"
                "fetch('https://example.invalid');\n"
                "const pre_tool_call = true;\n",
                encoding="utf-8",
            )

            payload = audit_plugin_risk(root)

        self.assertEqual(
            payload["summary"]["risk_categories"],
            [
                "declared_dependency",
                "dynamic_code_execution",
                "hermes_hook_capability",
                "network_request",
                "process_execution",
            ],
        )

    @requires_secure_dir_io
    def test_audit_does_not_treat_javascript_process_execution_as_dynamic_code(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "plugin.js").write_text("child_process.exec('tool');\n", encoding="utf-8")

            payload = audit_plugin_risk(root)

        self.assertEqual(payload["summary"]["risk_categories"], ["process_execution"])

    def test_audit_rejects_the_filesystem_root_before_scanning(self) -> None:
        filesystem_root = Path(Path.cwd().anchor)

        with self.assertRaisesRegex(ValueError, "filesystem root"):
            audit_plugin_risk(filesystem_root)

    def test_audit_rejects_special_audited_files_without_reading_them(self) -> None:
        if not hasattr(os, "mkfifo"):
            self.skipTest("named pipes are unavailable")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            os.mkfifo(root / "untrusted.py")

            with self.assertRaisesRegex(ValueError, "regular files"):
                audit_plugin_risk(root)

    @requires_secure_dir_io
    def test_audit_bounds_directory_entries_and_uses_only_the_root_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "plugin.json").write_text('{"name": "root"}\n', encoding="utf-8")
            nested = root / "nested"
            nested.mkdir()
            (nested / "plugin.json").write_text("not valid json", encoding="utf-8")

            payload = audit_plugin_risk(root)

            self.assertEqual(payload["source"]["manifest_status"], "present")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for index in range(129):
                (root / f"ignored-{index}.bin").write_text("ignored\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "at most 128 entries"):
                audit_plugin_risk(root)

    @requires_secure_dir_io
    def test_cli_audits_one_explicit_plugin_root_without_registering_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "plugin.json").write_text('{"name": "example"}\n', encoding="utf-8")
            (root / "plugin.py").write_text("def pre_llm_call() -> None:\n    return None\n", encoding="utf-8")

            status, stdout, stderr = run_cli(["ops", "plugin-risk-audit", "--path", str(root)])

        self.assertEqual(status, 0, stderr)
        payload = json.loads(stdout)
        self.assertEqual(payload["schema_version"], "plugin_risk_audit/v1")
        self.assertEqual(payload["summary"]["scanned_file_count"], 2)
        self.assertEqual(payload["not_observed"]["plugin_registration"]["status"], "not_observed")

    def test_security_safety_surface_exposes_the_explicit_plugin_audit(self) -> None:
        definitions = {definition.name: definition for definition in builtin_definitions()}
        harnesses = {harness.name: harness for harness in builtin_harnesses()}

        self.assertIn("plugin_risk_audit/v1 for one explicitly named local plugin directory", definitions["security-safety-review"].expected_outputs)
        self.assertIn("audit_plugin_risk", harnesses["security-safety-review"].wrapper_actions)
        self.assertIn("audit_plugin_risk", VISIBLE_ACTIONS)

        policy = recommend_module._SKILL_POLICIES["security-safety-review"]
        self.assertIn("plugin_risk_audit/v1", policy.evidence_boundary)
        self.assertIn("plugin_risk_audit/v1", policy.wrapper_guidance)

        payload = build_chat_interaction_payload("Run a local plugin risk audit before enablement.", source="discord")

        self.assertEqual(payload["route"]["selected_skill"], "security-safety-review")
        self.assertEqual(payload["next_action"], "prepare_security_safety_review")


if __name__ == "__main__":
    unittest.main()
