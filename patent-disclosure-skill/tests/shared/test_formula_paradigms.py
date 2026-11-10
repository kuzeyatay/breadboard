"""公式范式加载与 formula_plan 校验。"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.shared.check_formula_plan import check_plan
from tools.shared.formula_paradigms import load_paradigms, paradigm_by_id


class FormulaParadigmsTests(unittest.TestCase):
    def test_default_library_rich(self):
        cfg = load_paradigms()
        self.assertGreaterEqual(len(cfg["paradigms"]), 15)
        self.assertTrue(paradigm_by_id(cfg, "weighted_sum"))
        self.assertTrue(paradigm_by_id(cfg, "dual_threshold"))
        self.assertTrue(paradigm_by_id(cfg, "stoichiometric_reaction"))
        self.assertTrue(cfg.get("combos"))

    def test_case_override_merges(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "formula_paradigms.yaml"
            p.write_text(
                "version: 1\nparadigms:\n"
                "  - id: my_custom\n    name_zh: 自定义\n"
                "    when_zh: 测试\n    latex: 's = x'\n    notes_zh: ''\n",
                encoding="utf-8",
            )
            cfg = load_paradigms(td)
            self.assertTrue(paradigm_by_id(cfg, "weighted_sum"))
            self.assertTrue(paradigm_by_id(cfg, "my_custom"))

    def test_check_plan_ok_and_forbid_tilde(self):
        plan_ok = {
            "paradigm_ids": ["weighted_sum", "dual_threshold"],
            "plain_zh": "匹配分加权后按双条件触发",
            "equations": [
                {
                    "tag": 1,
                    "paradigm_id": "weighted_sum",
                    "latex": r"s = \alpha x + \beta y",
                    "role": "score",
                }
            ],
            "numeric_example": {"given": {"x": 1, "y": 1}, "result": {"s": 1}},
        }
        r = check_plan(plan_ok)
        self.assertTrue(r["ok"], r)

        plan_bad = {
            "paradigm_ids": ["weighted_sum"],
            "equations": [
                {
                    "tag": 1,
                    "paradigm_id": "weighted_sum",
                    "latex": r"s = \tilde{a}",
                    "role": "score",
                }
            ],
            "numeric_example": {"given": {"a": 1}, "result": {"s": 1}},
        }
        r2 = check_plan(plan_bad)
        self.assertFalse(r2["ok"])
        self.assertTrue(any("tilde" in e for e in r2["errors"]))


if __name__ == "__main__":
    unittest.main()
