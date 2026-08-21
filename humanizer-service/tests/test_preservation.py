"""The gate, tested on the failures it exists to catch.

Each test here is a way a rewriter can be wrong that a reader would not notice:
a number that moved, a citation that vanished, a percentage that was invented, a
quotation that was paraphrased. The gate does not have to understand any of it -
it only has to refuse.
"""

import unittest

from breadboard_humanizer.preservation import (
    check_chunk,
    check_document,
    critical_literals,
)

from .fixtures import ACCEPTANCE_MARKDOWN


def codes(warnings):
    return [warning.code for warning in warnings]


class ChunkGateTest(unittest.TestCase):
    def test_a_faithful_rewrite_passes(self):
        self.assertEqual(
            check_chunk(
                "The system XP0X is a big step forward for local software.",
                "The system XP0X is a real step up for local software.",
                0,
            ),
            [],
        )

    def test_a_changed_number_is_refused(self):
        warnings = check_chunk(
            "Throughput rose 18 points last quarter.",
            "Throughput rose 19 points last quarter.",
            1,
        )
        self.assertIn("literal_removed", codes(warnings))
        self.assertIn("literal_invented", codes(warnings))

    def test_an_invented_number_is_refused(self):
        warnings = check_chunk(
            "Throughput rose noticeably last quarter.",
            "Throughput rose 30% last quarter.",
            2,
        )
        self.assertIn("literal_invented", codes(warnings))
        self.assertIn("percent", warnings[0].kinds + warnings[-1].kinds)

    def test_a_missing_citation_is_refused(self):
        warnings = check_chunk(
            "The effect is well established [@smith2020].",
            "The effect is well established.",
            3,
        )
        self.assertIn("literal_removed", codes(warnings))
        self.assertIn("citation", [kind for w in warnings for kind in w.kinds])

    def test_a_lost_placeholder_is_refused(self):
        self.assertIn(
            "placeholder_lost",
            codes(check_chunk("Run XP0X first.", "Run it first.", 4)),
        )

    def test_a_reordered_placeholder_is_refused(self):
        self.assertIn(
            "placeholder_lost",
            codes(check_chunk("XP0X then XP1X", "XP1X then XP0X", 5)),
        )

    def test_an_empty_rewrite_is_refused_on_its_own(self):
        self.assertEqual(codes(check_chunk("Some prose here.", "   ", 6)), ["empty_rewrite"])

    def test_disproportionate_length_is_refused(self):
        long_original = "This sentence has a reasonable number of words in it indeed."
        self.assertIn(
            "length_out_of_bounds", codes(check_chunk(long_original, "Short.", 7))
        )
        self.assertIn(
            "length_out_of_bounds",
            codes(check_chunk("Short input.", "Short input. " * 12, 8)),
        )

    def test_repeated_text_is_refused(self):
        self.assertIn(
            "repeated_text",
            codes(check_chunk("A clear statement of fact.", "A clear fact. A clear fact.", 9)),
        )

    def test_added_markdown_structure_is_refused(self):
        self.assertIn(
            "structure_changed",
            codes(check_chunk("plain words about things", "# plain words about things", 10)),
        )
        self.assertIn(
            "structure_changed",
            codes(check_chunk("one line of prose here", "one line\nof prose here", 11)),
        )

    def test_control_characters_are_refused(self):
        self.assertIn(
            "invalid_unicode",
            codes(check_chunk("clean prose here", "clean\x07prose here", 12)),
        )

    def test_a_sentence_that_suddenly_starts_mid_word_is_refused(self):
        warnings = check_chunk(
            "Lichens are composite organisms living in mutual dependence.",
            "ehens are composite organisms living in mutual dependence.",
            12,
        )
        self.assertIn("truncated_word", codes(warnings))

    def test_warnings_never_carry_the_text_they_are_about(self):
        for warning in check_chunk(
            "Revenue was 4 million in Q3 per [@smith2020].",
            "Revenue was 9 million.",
            13,
        ):
            serialized = str(warning.as_dict())
            self.assertNotIn("Revenue", serialized)
            self.assertNotIn("smith2020", serialized)
            self.assertNotIn("million", serialized)


class LiteralExtractionTest(unittest.TestCase):
    def test_kinds_are_part_of_identity(self):
        literals = critical_literals("Released 2.4 on 2026-08-19 with 18.5% uptake.")
        self.assertIn("version:2.4", literals)
        self.assertIn("date:2026-08-19", literals)
        self.assertIn("percent:18.5%", literals)

    def test_proper_names_are_only_taken_mid_sentence(self):
        # Sentence-initial capitals are grammar; mid-sentence ones are names.
        self.assertNotIn("name:The System", critical_literals("The System is fine."))
        self.assertIn("name:Release Candidate", critical_literals("we shipped Release Candidate today"))


class DocumentGateTest(unittest.TestCase):
    def test_an_untouched_document_passes(self):
        self.assertEqual(check_document(ACCEPTANCE_MARKDOWN, ACCEPTANCE_MARKDOWN), [])

    def test_a_prose_only_rewrite_passes(self):
        rewritten = ACCEPTANCE_MARKDOWN.replace(
            "groundbreaking and transformative", "useful"
        )
        self.assertEqual(check_document(ACCEPTANCE_MARKDOWN, rewritten), [])

    def test_a_dropped_code_fence_is_caught(self):
        original = "para\n\n```py\nx = 1\n```\n"
        self.assertIn(
            "document_structure_changed", codes(check_document(original, "para\n"))
        )

    def test_a_changed_url_is_caught(self):
        rewritten = ACCEPTANCE_MARKDOWN.replace("releases/2.4", "releases/2.5")
        self.assertIn(
            "document_literal_removed", codes(check_document(ACCEPTANCE_MARKDOWN, rewritten))
        )

    def test_a_surviving_placeholder_is_never_published(self):
        self.assertIn(
            "unresolved_placeholder",
            codes(check_document("hello there\n", "hello XP0X there\n")),
        )

    def test_a_changed_heading_marker_is_caught(self):
        self.assertIn(
            "document_structure_changed",
            codes(check_document("# Title\n\nbody\n", "## Title\n\nbody\n")),
        )


if __name__ == "__main__":
    unittest.main()
