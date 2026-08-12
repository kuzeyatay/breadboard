from __future__ import annotations

import unittest

from chatmock.council.prompts import BREADBOARD_COUNCIL_SYSTEM
from chatmock.providers.claude_code import _system_prompt


class AssistantIdentityTests(unittest.TestCase):
    def test_council_keeps_bread_as_the_user_facing_identity(self) -> None:
        self.assertTrue(
            BREADBOARD_COUNCIL_SYSTEM.startswith(
                "You are Bread, the Breadboard assistant."
            )
        )
        self.assertIn("Hermes is the agent runtime", BREADBOARD_COUNCIL_SYSTEM)

    def test_claude_code_wrapper_does_not_replace_breads_name(self) -> None:
        prompt = _system_prompt({"tool_choice": "none"}, [])
        self.assertIn("The user-facing assistant's name is Bread", prompt)
        self.assertIn("Hermes", prompt)
        self.assertIn("runtime details, not the assistant's name", prompt)


if __name__ == "__main__":
    unittest.main()

