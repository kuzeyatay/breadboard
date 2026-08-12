"""The upstream's own sentence is what tells a person what to do about a failure."""

from __future__ import annotations

import unittest

from chatmock.utils import UPSTREAM_ERROR_MESSAGE_LIMIT, upstream_error_message


class UpstreamErrorMessageTests(unittest.TestCase):
    def test_reads_the_openai_error_shape(self) -> None:
        self.assertEqual(
            upstream_error_message(
                {"error": {"message": "The usage limit has been reached", "type": "usage_limit_reached"}}
            ),
            "The usage limit has been reached",
        )

    def test_reads_the_detail_shape_the_backend_uses_to_refuse_a_model(self) -> None:
        # The regression this module exists for: a refusal names the model and
        # the account, and was being replaced with the words "Upstream error".
        detail = "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account."
        self.assertEqual(upstream_error_message({"detail": detail}), detail)

    def test_reads_a_validation_style_detail_list(self) -> None:
        self.assertEqual(
            upstream_error_message({"detail": [{"msg": "bad model"}, {"msg": "bad input"}]}),
            "bad model; bad input",
        )

    def test_reads_a_plain_string_error(self) -> None:
        self.assertEqual(upstream_error_message({"error": "nope"}), "nope")
        self.assertEqual(upstream_error_message("nope"), "nope")

    def test_falls_back_to_raw_text_then_the_default(self) -> None:
        self.assertEqual(upstream_error_message({"raw": "  gateway exploded  "}), "gateway exploded")
        self.assertEqual(upstream_error_message({}), "Upstream error")
        self.assertEqual(upstream_error_message({"error": {}}), "Upstream error")
        self.assertEqual(upstream_error_message({"detail": "   "}), "Upstream error")
        self.assertEqual(upstream_error_message(None), "Upstream error")

    def test_never_returns_an_unbounded_body(self) -> None:
        message = upstream_error_message({"detail": "x" * 5_000})
        self.assertEqual(len(message), UPSTREAM_ERROR_MESSAGE_LIMIT)


if __name__ == "__main__":
    unittest.main()
