from __future__ import annotations

import unittest

from _local_package import load_local_package

load_local_package()
from omh.skills.context_cost import skill_context_cost_profile


class SkillContextCostTests(unittest.TestCase):
    def test_full_profile_moves_common_rails_out_of_skill_bodies(self) -> None:
        profile = skill_context_cost_profile("full")
        headings = {row["heading"]: row for row in profile["headings"]}

        self.assertEqual(headings.get("OMH Context Rail", {"duplicate_bytes": 0})["duplicate_bytes"], 0)
        self.assertEqual(
            headings.get("Hermes Compatibility Contract", {"duplicate_bytes": 0})["duplicate_bytes"],
            0,
        )
        self.assertLess(profile["repeated"]["bytes"], 100_000)


if __name__ == "__main__":
    unittest.main()
