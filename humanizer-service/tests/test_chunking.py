"""Segmentation and packing: the half of the pipeline the model cannot break.

Every test here runs without a model. If one of these fails, the document would
have been damaged before inference had a chance to be blamed for it.
"""

import unittest

from breadboard_humanizer.chunking import (
    PLACEHOLDER_PATTERN,
    ChunkingError,
    build_chunks,
    expose_checkable_facts,
    pack_sentences,
    placeholders_intact,
    protect_inline,
    reassemble,
    restore_inline,
    segment_markdown,
    split_sentences,
)

from .fakes import word_tokens
from .fixtures import ACCEPTANCE_MARKDOWN


def labels(text):
    return [(segment.kind, segment.label) for segment in segment_markdown(text)]


def prose_bodies(text):
    return [
        segment.body for segment in segment_markdown(text) if segment.kind == "prose"
    ]


class RoundTripTest(unittest.TestCase):
    """Segmentation must be lossless before anything else is worth testing."""

    def assert_round_trips(self, text):
        self.assertEqual(reassemble(segment_markdown(text)), text)

    def test_the_acceptance_fixture_round_trips(self):
        self.assert_round_trips(ACCEPTANCE_MARKDOWN)

    def test_awkward_documents_round_trip(self):
        for text in (
            "",
            "one line, no newline",
            "\n\n\n",
            "# heading\n",
            "- a\n- b\n",
            "text\r\nwith\r\ncrlf\r\n",
            "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
            "```py\nx = 1\n```\n",
            "    indented code\n",
            "$$\n\\int x\n$$\n",
            "<div>\nraw\n</div>\n",
            "> quoted\n> lines\n",
            "[ref]: https://example.com\n",
            "Setext\n======\n",
            "hard break  \nsecond line\n",
            "a paragraph\nsoft wrapped\nover three lines\n",
        ):
            with self.subTest(text=text):
                self.assert_round_trips(text)


class BlockProtectionTest(unittest.TestCase):
    def test_frontmatter_is_protected_whole(self):
        segments = segment_markdown(ACCEPTANCE_MARKDOWN)
        self.assertEqual(segments[0].kind, "protected")
        self.assertEqual(segments[0].label, "frontmatter")
        self.assertEqual(
            segments[0].raw, "---\ntitle: Release notes\nversion: 2.4\n---\n"
        )

    def test_fenced_code_is_never_prose(self):
        text = "before\n\n```python\n# this comment must survive\nx = 1\n```\n\nafter\n"
        kinds = labels(text)
        self.assertIn(("protected", "fenced_code"), kinds)
        self.assertNotIn("# this comment must survive", "".join(prose_bodies(text)))

    def test_indented_code_is_protected_but_list_continuation_is_not(self):
        self.assertIn(("protected", "indented_code"), labels("para\n\n    code()\n"))
        self.assertNotIn(
            ("protected", "indented_code"), labels("- item\n\n    continued text\n")
        )

    def test_math_tables_html_and_quotes_are_protected(self):
        self.assertIn(("protected", "math_block"), labels("$$\na = b\n$$\n"))
        self.assertIn(
            ("protected", "table"), labels("| a | b |\n| --- | --- |\n| 1 | 2 |\n")
        )
        self.assertIn(("protected", "html_block"), labels("<section>\nhi\n</section>\n"))
        self.assertIn(("protected", "blockquote"), labels("> quoted material\n"))
        self.assertIn(
            ("protected", "reference_definition"), labels("[one]: https://example.com\n")
        )

    def test_headings_and_list_markers_are_prefixes_not_prose(self):
        segments = segment_markdown("## A Heading\n\n- [ ] a task\n1. numbered\n")
        prose = [segment for segment in segments if segment.kind == "prose"]
        self.assertEqual(
            [(segment.prefix, segment.body) for segment in prose],
            [("## ", "A Heading"), ("- [ ] ", "a task"), ("1. ", "numbered")],
        )

    def test_paragraphs_stay_separate(self):
        bodies = prose_bodies("First thought.\n\nSecond thought.\n")
        self.assertEqual(bodies, ["First thought.", "Second thought."])

    def test_a_soft_wrapped_paragraph_is_one_thought(self):
        self.assertEqual(
            prose_bodies("one line\nand its continuation\n"),
            ["one line and its continuation"],
        )

    def test_a_hard_break_keeps_its_lines_apart(self):
        segments = [s for s in segment_markdown("one  \ntwo  \n") if s.kind == "prose"]
        self.assertEqual([segment.body for segment in segments], ["one", "two"])
        self.assertEqual(segments[0].suffix, "  \n")


class InlineProtectionTest(unittest.TestCase):
    def protected_kinds(self, text):
        _, fragments = protect_inline(text)
        return {fragment.kind: fragment.text for fragment in fragments}

    def test_opaque_and_format_sensitive_literals_become_placeholders(self):
        found = self.protected_kinds(
            "See [the report](https://example.com/a) or https://example.org, "
            "mail a@b.com, run `npm run build` with --force on /usr/lib/x, "
            "version 2.4.1 on August 19, 2026 at 09:30, up 18.5% and $12.50, "
            "cited [@smith2020] and [^1], ask @someone about #topic, "
            'note "a quoted passage" and file report-2024.'
        )
        for kind in (
            "link",
            "url",
            "email",
            "code",
            "flag",
            "path",
            "citation",
            "footnote",
            "handle",
            "hashtag",
            "quote",
            "identifier",
        ):
            with self.subTest(kind=kind):
                self.assertIn(kind, found)

    def test_plain_fact_literals_stay_readable_for_the_model(self):
        text = "Version 2.4 shipped on August 19, 2026 at 09:30, up 18.5% and $12.50."
        masked, fragments = protect_inline(text)
        self.assertNotEqual(masked, text)
        self.assertEqual(expose_checkable_facts(masked, fragments), text)

    def test_placeholders_round_trip(self):
        text = "Version 2.4 shipped on August 19, 2026 at https://example.com/x."
        masked, fragments = protect_inline(text)
        self.assertNotIn("https://", masked)
        model_input = expose_checkable_facts(masked, fragments)
        self.assertIn("2.4", model_input)
        self.assertNotIn("https://", model_input)
        self.assertEqual(restore_inline(masked, fragments), text)

    def test_breadboard_source_citations_are_one_protected_fragment(self):
        text = "The finding holds [S1][S2][S3] and is independently repeated [S4], [S5]."
        masked, fragments = protect_inline(text)
        self.assertEqual(
            masked,
            "The finding holds XP0X and is independently repeated XP1X.",
        )
        self.assertEqual([fragment.kind for fragment in fragments], ["citation", "citation"])
        self.assertEqual(restore_inline(masked, fragments), text)

    def test_markdown_emphasis_is_never_reproduced_from_model_memory(self):
        text = "**Fragment I. Junghans, 1924** names *Xanthoria parietina*."
        masked, fragments = protect_inline(text)
        self.assertEqual([fragment.kind for fragment in fragments], ["strong", "emphasis"])
        self.assertNotIn("**", masked)
        self.assertNotIn("Xanthoria", masked)
        self.assertEqual(restore_inline(masked, fragments), text)

    def test_text_that_already_looks_like_a_placeholder_is_refused(self):
        with self.assertRaises(ChunkingError):
            protect_inline("a XP0X in the source")

    def test_placeholder_validation_catches_loss_and_reordering(self):
        self.assertTrue(placeholders_intact("a XP0X b XP1X", "b XP0X a XP1X"))
        self.assertFalse(placeholders_intact("a XP0X b XP1X", "a XP0X b"))
        self.assertFalse(placeholders_intact("a XP0X b XP1X", "XP1X then XP0X"))
        self.assertFalse(placeholders_intact("a XP0X", "a XP0X XP0X"))


class PackingTest(unittest.TestCase):
    def test_whole_sentences_are_packed_up_to_the_budget(self):
        text = "One two three. Four five six. Seven eight nine."
        packed = pack_sentences(text, word_tokens, max_tokens=9, hard_ceiling=20)
        self.assertEqual(len(packed), 2)
        self.assertEqual("".join(piece + sep for piece, sep in packed), text)

    def test_no_chunk_exceeds_the_configured_ceiling(self):
        text = " ".join("Sentence number %d here." % index for index in range(40))
        for piece, _ in pack_sentences(text, word_tokens, max_tokens=20, hard_ceiling=25):
            self.assertLessEqual(word_tokens(piece), 25)

    def test_one_overlong_sentence_is_split_on_word_boundaries(self):
        sentence = " ".join(["word"] * 60) + "."
        pieces = pack_sentences(sentence, word_tokens, max_tokens=10, hard_ceiling=12)
        self.assertGreater(len(pieces), 1)
        for piece, _ in pieces:
            self.assertLessEqual(word_tokens(piece), 12)
        self.assertEqual("".join(piece + sep for piece, sep in pieces), sentence)

    def test_abbreviations_do_not_end_a_sentence(self):
        self.assertEqual(len(split_sentences("Use e.g. this one. Then stop.")), 2)

    def test_unrelated_paragraphs_are_never_merged(self):
        first = "The first paragraph makes its own point."
        second = "The second paragraph makes a different one."
        segments = segment_markdown(first + "\n\n" + second + "\n")
        chunks = build_chunks(segments, word_tokens, max_tokens=200)
        self.assertEqual([chunk.text for chunk in chunks], [first, second])

    def test_a_heading_is_never_sent_to_the_model(self):
        # Measured, not assumed: this checkpoint answers a heading with an essay
        # title rather than a rewording. See UNREWRITABLE_LABELS.
        segments = segment_markdown("# A Pivotal New Chapter\n")
        self.assertEqual(build_chunks(segments, word_tokens), [])

    def test_a_standalone_bold_fragment_heading_is_never_sent_to_the_model(self):
        source = "**Fragment I. Junghans, 1924**\n"
        segments = segment_markdown(source)
        self.assertEqual(build_chunks(segments, word_tokens), [])
        self.assertEqual(reassemble(segments), source)

    def test_a_leading_bold_list_label_is_preserved_as_structure(self):
        segments = segment_markdown("* **The data:** This sentence can be rewritten safely.\n")
        prose = [segment for segment in segments if segment.kind == "prose"]
        self.assertEqual(prose[0].prefix, "* **The data:** ")
        self.assertEqual(prose[0].body, "This sentence can be rewritten safely.")

    def test_a_breadboard_source_list_is_not_sent_to_the_model(self):
        source = (
            "* **[S1], [S2], [S3]**: Source names and publication details.\n"
            "* This ordinary sentence should still be rewritten by the model.\n"
        )
        chunks = build_chunks(segment_markdown(source), word_tokens)
        self.assertEqual(
            [chunk.text for chunk in chunks],
            ["This ordinary sentence should still be rewritten by the model."],
        )

    def test_a_fragment_too_short_to_be_a_sentence_is_skipped(self):
        segments = segment_markdown("Run it first.\n")
        self.assertEqual(build_chunks(segments, word_tokens), [])

    def test_a_segment_of_pure_literals_is_not_sent_to_the_model(self):
        segments = segment_markdown("https://example.com/only\n")
        self.assertEqual(build_chunks(segments, word_tokens), [])

    def test_chunks_mask_opaque_spans_but_leave_checkable_facts_readable(self):
        segments = segment_markdown(ACCEPTANCE_MARKDOWN)
        chunks = build_chunks(segments, word_tokens)
        joined = " ".join(
            expose_checkable_facts(chunk.text, chunk.fragments) for chunk in chunks
        )
        for literal in ("https://", "npm run build"):
            self.assertNotIn(literal, joined)
        self.assertIn("18.5%", joined)
        self.assertIn("August 19, 2026", joined)
        self.assertTrue(PLACEHOLDER_PATTERN.search(joined))


if __name__ == "__main__":
    unittest.main()
