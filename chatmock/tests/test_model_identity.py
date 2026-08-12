from __future__ import annotations

import unittest

from chatmock.model_identity import (
    RESOLVED_MODEL_PLACEHOLDER,
    RESOLVED_PROVIDER_PLACEHOLDER,
    with_resolved_model_identity,
)


class ModelIdentityTests(unittest.TestCase):
    def test_resolves_nested_markers_without_mutating_the_request(self) -> None:
        original = {
            "messages": [
                {
                    "role": "system",
                    "content": (
                        f"Model: {RESOLVED_MODEL_PLACEHOLDER}\n"
                        f"Provider: {RESOLVED_PROVIDER_PLACEHOLDER}"
                    ),
                }
            ],
            "stream": True,
        }

        resolved = with_resolved_model_identity(
            original,
            model="cliproxy/claude-opus-5",
            provider="cliproxy",
        )

        self.assertTrue(
            original["messages"][0]["content"].endswith(
                RESOLVED_PROVIDER_PLACEHOLDER
            )
        )
        self.assertEqual(
            resolved["messages"][0]["content"],
            "Model: cliproxy/claude-opus-5\nProvider: cliproxy",
        )
        self.assertIs(resolved["stream"], True)


if __name__ == "__main__":
    unittest.main()
