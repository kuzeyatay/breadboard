from __future__ import annotations

import unittest

from chatmock.council.policy import CouncilConfig
from chatmock.model_registry import DEFAULT_MODEL, allowed_efforts_for_model, list_public_models, normalize_model_name


class ModelRegistryTests(unittest.TestCase):
    def test_normalizes_aliases(self) -> None:
        self.assertEqual(normalize_model_name("gpt6-astra"), "gpt-6-astra")
        self.assertEqual(normalize_model_name("gpt-6-astra-latest"), "gpt-6-astra")
        self.assertEqual(normalize_model_name("gpt-5.6"), "gpt-5.6-sol")
        self.assertEqual(normalize_model_name("gpt5.6-sol"), "gpt-5.6-sol")
        self.assertEqual(normalize_model_name("gpt5.6-terra"), "gpt-5.6-terra")
        self.assertEqual(normalize_model_name("gpt-5.6-luna-latest"), "gpt-5.6-luna")
        self.assertEqual(normalize_model_name("gpt5"), "gpt-5")
        self.assertEqual(normalize_model_name("gpt5.4"), "gpt-5.4")
        self.assertEqual(normalize_model_name("gpt5.5"), "gpt-5.5")
        self.assertEqual(normalize_model_name("gpt5.4-mini"), "gpt-5.4-mini")
        self.assertEqual(normalize_model_name("gpt5.3-codex-spark"), "gpt-5.3-codex-spark")
        self.assertEqual(normalize_model_name("codex"), "codex-mini-latest")

    def test_missing_model_defaults_to_gpt_5_6_sol(self) -> None:
        self.assertEqual(DEFAULT_MODEL, "gpt-5.6-sol")
        self.assertEqual(normalize_model_name(None), DEFAULT_MODEL)
        self.assertEqual(normalize_model_name("  "), DEFAULT_MODEL)

        council = CouncilConfig()
        self.assertEqual(council.council_models, [DEFAULT_MODEL])
        self.assertEqual(council.chairman_model, DEFAULT_MODEL)
        self.assertEqual(council.upstream_fallback_model, DEFAULT_MODEL)

    def test_strips_reasoning_suffixes(self) -> None:
        self.assertEqual(normalize_model_name("gpt-6-astra:max"), "gpt-6-astra")
        self.assertEqual(normalize_model_name("gpt-6-astra-xhigh"), "gpt-6-astra")
        self.assertEqual(normalize_model_name("gpt-5.6:max"), "gpt-5.6-sol")
        self.assertEqual(normalize_model_name("gpt-5.6-sol-max"), "gpt-5.6-sol")
        self.assertEqual(normalize_model_name("gpt-5.6-terra-max"), "gpt-5.6-terra")
        self.assertEqual(normalize_model_name("gpt-5.6-luna:max"), "gpt-5.6-luna")
        self.assertEqual(normalize_model_name("gpt-5.4-high"), "gpt-5.4")
        self.assertEqual(normalize_model_name("gpt-5.4-mini-high"), "gpt-5.4-mini")
        self.assertEqual(normalize_model_name("gpt-5.2_codemirror"), "gpt-5.2_codemirror")
        self.assertEqual(normalize_model_name("gpt-5.1-codex:max"), "gpt-5.1-codex:max")
        self.assertEqual(normalize_model_name("gpt-5.1-codex:high"), "gpt-5.1-codex")

    def test_allowed_efforts_follow_registry(self) -> None:
        self.assertEqual(
            allowed_efforts_for_model("gpt-6-astra"),
            frozenset(("low", "medium", "high", "xhigh", "max")),
        )
        self.assertEqual(
            allowed_efforts_for_model("gpt-5.6"),
            frozenset(("none", "low", "medium", "high", "xhigh", "max")),
        )
        self.assertEqual(
            allowed_efforts_for_model("gpt-5.6-terra"),
            frozenset(("none", "low", "medium", "high", "xhigh", "max")),
        )
        self.assertEqual(
            allowed_efforts_for_model("gpt-5.6-luna"),
            frozenset(("none", "low", "medium", "high", "xhigh", "max")),
        )
        self.assertEqual(allowed_efforts_for_model("gpt-5.4"), frozenset(("none", "low", "medium", "high", "xhigh")))
        self.assertEqual(allowed_efforts_for_model("gpt-5.4-mini"), frozenset(("low", "medium", "high", "xhigh")))
        self.assertEqual(allowed_efforts_for_model("gpt-5.1-codex"), frozenset(("low", "medium", "high")))

    def test_public_models_include_variants(self) -> None:
        model_ids = list_public_models(expose_reasoning_models=True)
        self.assertEqual(model_ids[0], "gpt-6-astra")
        self.assertIn("gpt-6-astra-max", model_ids)
        self.assertIn("gpt-5.6-sol-max", model_ids)
        self.assertIn("gpt-5.6-terra", model_ids)
        self.assertIn("gpt-5.6-terra-max", model_ids)
        self.assertIn("gpt-5.6-luna", model_ids)
        self.assertIn("gpt-5.6-luna-max", model_ids)
        self.assertIn("gpt-5.4", model_ids)
        self.assertIn("gpt-5.5", model_ids)
        self.assertIn("gpt-5.4-mini", model_ids)
        self.assertIn("gpt-5.3-codex-spark", model_ids)
        self.assertIn("gpt-5.4-none", model_ids)
        self.assertIn("gpt-5.5-none", model_ids)
        self.assertIn("gpt-5.4-mini-xhigh", model_ids)
        self.assertNotIn("gpt-5.4-mini-none", model_ids)
        self.assertIn("gpt-5.1-codex-max-xhigh", model_ids)
        self.assertNotIn("codex-mini-high", model_ids)


if __name__ == "__main__":
    unittest.main()
