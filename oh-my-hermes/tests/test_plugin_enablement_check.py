from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from _cli_harness import run_cli
from _local_package import load_local_package

load_local_package()
from omh.config_adapter import plugin_enablement, plugin_is_enabled
from omh.maintenance.doctor import run_doctor
from omh.paths import resolve_paths
from omh.plugin_pack import PLUGIN_NAME


ENABLED_CONFIG = """skills:
  external_dirs: []

plugins:
  enabled:
    - omh
  disabled: []
  entries:
    omh:
      allow_tool_override: false
"""

DISABLED_CONFIG = ENABLED_CONFIG.replace("  enabled:\n    - omh\n", "  enabled:\n")


class PluginEnablementReaderTests(unittest.TestCase):
    """Hermes keeps enablement in `plugins.enabled` and nowhere else."""

    def test_block_list_form(self) -> None:
        self.assertTrue(plugin_is_enabled(ENABLED_CONFIG, PLUGIN_NAME))
        self.assertFalse(plugin_is_enabled(DISABLED_CONFIG, PLUGIN_NAME))

    def test_inline_list_form(self) -> None:
        self.assertTrue(plugin_is_enabled("plugins:\n  enabled: [omh, other]\n  disabled: []\n", PLUGIN_NAME))
        self.assertFalse(plugin_is_enabled("plugins:\n  enabled: []\n  disabled: []\n", PLUGIN_NAME))

    def test_explicitly_disabled_outranks_enabled(self) -> None:
        text = "plugins:\n  enabled:\n    - omh\n  disabled:\n    - omh\n"
        self.assertFalse(plugin_is_enabled(text, PLUGIN_NAME))

    def test_quoted_items_are_read(self) -> None:
        self.assertTrue(plugin_is_enabled('plugins:\n  enabled:\n    - "omh"\n  disabled: []\n', PLUGIN_NAME))

    def test_a_config_without_a_plugins_block_is_not_enabled(self) -> None:
        self.assertFalse(plugin_is_enabled("skills:\n  external_dirs: []\n", PLUGIN_NAME))

    def test_another_plugin_does_not_count(self) -> None:
        self.assertFalse(plugin_is_enabled("plugins:\n  enabled:\n    - browser\n  disabled: []\n", PLUGIN_NAME))

    def test_enablement_reports_both_lists(self) -> None:
        listed = plugin_enablement("plugins:\n  enabled:\n    - omh\n  disabled:\n    - browser\n")
        self.assertEqual(listed, {"enabled": ["omh"], "disabled": ["browser"]})


class DoctorPluginEnabledCheckTests(unittest.TestCase):
    """The gap this closes: everything installed, nothing reachable.

    A live check found `omh doctor` reporting `Hermes registration: ok (4/4)`
    while the plugin sat disabled in Hermes, so no OMH tool was callable in chat
    and no check said so. Bundle installed, importable, and registrable are all
    separate questions from whether Hermes will load it.
    """

    def _paths(self, root: Path, config_text: str):
        hermes = root / ".hermes"
        (hermes / "plugins" / PLUGIN_NAME).mkdir(parents=True)
        (hermes / "config.yaml").write_text(config_text, encoding="utf-8")
        return resolve_paths(root / ".omh", hermes)

    def _check(self, checks, name: str):
        return next((c for c in checks if c.name == name), None)

    def test_a_disabled_plugin_is_a_blocking_check(self) -> None:
        with TemporaryDirectory() as tmp:
            paths = self._paths(Path(tmp), DISABLED_CONFIG)
            check = self._check(run_doctor(paths), "plugin_enabled_in_hermes")
            self.assertIsNotNone(check)
            self.assertFalse(check.ok)
            self.assertEqual(check.severity, "blocking")
            self.assertIn("not in plugins.enabled", check.message)
            self.assertIn("no OMH tool is reachable", check.message)
            self.assertIn(f"hermes plugins enable {PLUGIN_NAME}", check.remediation)

    def test_an_enabled_plugin_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            paths = self._paths(Path(tmp), ENABLED_CONFIG)
            check = self._check(run_doctor(paths), "plugin_enabled_in_hermes")
            self.assertIsNotNone(check)
            self.assertTrue(check.ok, check.message)

    def test_an_explicitly_disabled_plugin_says_so(self) -> None:
        with TemporaryDirectory() as tmp:
            text = "plugins:\n  enabled:\n    - omh\n  disabled:\n    - omh\n"
            paths = self._paths(Path(tmp), text)
            check = self._check(run_doctor(paths), "plugin_enabled_in_hermes")
            self.assertFalse(check.ok)
            self.assertIn("listed as disabled", check.message)

    def test_a_missing_config_does_not_block(self) -> None:
        """Before setup runs there is nothing to enable, and that is not a fault."""
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".hermes" / "plugins" / PLUGIN_NAME).mkdir(parents=True)
            paths = resolve_paths(root / ".omh", root / ".hermes")
            check = self._check(run_doctor(paths), "plugin_enabled_in_hermes")
            self.assertTrue(check.ok)
            self.assertFalse(check.observed)

    def test_the_check_only_runs_when_a_bundle_is_installed(self) -> None:
        """No installed bridge means nothing to enable; doctor must not invent a fault."""
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".hermes").mkdir(parents=True)
            (root / ".hermes" / "config.yaml").write_text(DISABLED_CONFIG, encoding="utf-8")
            paths = resolve_paths(root / ".omh", root / ".hermes")
            self.assertIsNone(self._check(run_doctor(paths), "plugin_enabled_in_hermes"))


class SetupEnablesThePluginTests(unittest.TestCase):
    """Installing the bridge without switching it on is the same as not shipping it."""

    def test_setup_leaves_the_plugin_enabled_and_doctor_clean(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = ["--omh-home", str(root / ".omh"), "--hermes-home", str(root / ".hermes")]

            status, _stdout, stderr = run_cli(base + ["setup"])
            self.assertEqual(stderr, "")
            self.assertEqual(status, 0)

            config_text = (root / ".hermes" / "config.yaml").read_text(encoding="utf-8")
            self.assertTrue(
                plugin_is_enabled(config_text, PLUGIN_NAME),
                f"setup installed the bridge without enabling it: {plugin_enablement(config_text)}",
            )

            paths = resolve_paths(root / ".omh", root / ".hermes")
            check = next((c for c in run_doctor(paths) if c.name == "plugin_enabled_in_hermes"), None)
            self.assertIsNotNone(check)
            self.assertTrue(check.ok, check.message)

    def test_setup_does_not_re_enable_a_deliberate_opt_out(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = ["--omh-home", str(root / ".omh"), "--hermes-home", str(root / ".hermes")]
            status, _stdout, stderr = run_cli(base + ["setup"])
            self.assertEqual(status, 0, stderr)

            config_path = root / ".hermes" / "config.yaml"
            opted_out = config_path.read_text(encoding="utf-8").replace(
                "  enabled:\n    - omh\n", "  enabled:\n  disabled:\n    - omh\n"
            )
            config_path.write_text(opted_out, encoding="utf-8")

            status, _stdout, stderr = run_cli(base + ["setup"])
            self.assertEqual(status, 0, stderr)
            self.assertFalse(
                plugin_is_enabled(config_path.read_text(encoding="utf-8"), PLUGIN_NAME),
                "setup must not override an explicit opt-out",
            )


if __name__ == "__main__":
    unittest.main()
