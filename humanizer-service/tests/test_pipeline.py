"""The whole rewrite, with the model faked.

The acceptance case lives here: the fixture from the integration brief goes in,
and everything a reader would be misled by comes out identical while the generic
sentence changes. The rest of the file is about what happens when the model
misbehaves, which is the case the design actually turns on.
"""

import unittest
from unittest import mock

from breadboard_humanizer.pipeline import CancelledError, PipelineError, humanize
from breadboard_humanizer.preservation import Warning_

from .fakes import FakeHumanizer, default_transform
from .fixtures import (
    ACCEPTANCE_GENERIC_PROSE,
    ACCEPTANCE_INVARIANTS,
    ACCEPTANCE_MARKDOWN,
)


class AcceptanceTest(unittest.TestCase):
    def setUp(self):
        self.model = FakeHumanizer()
        self.result = humanize(ACCEPTANCE_MARKDOWN, self.model)

    def test_every_protected_literal_survives_byte_for_byte(self):
        for invariant in ACCEPTANCE_INVARIANTS:
            with self.subTest(invariant=invariant):
                self.assertIn(invariant, self.result.rewritten_text)

    def test_the_generic_prose_is_actually_rewritten(self):
        self.assertNotIn(ACCEPTANCE_GENERIC_PROSE, self.result.rewritten_text)
        self.assertNotEqual(self.result.rewritten_text, ACCEPTANCE_MARKDOWN)

    def test_no_placeholder_reaches_the_output(self):
        self.assertNotIn("XP", self.result.rewritten_text)

    def test_the_document_gate_passed(self):
        self.assertTrue(self.result.preservation_passed)
        self.assertEqual(self.result.reverted_chunks, 0)
        self.assertEqual(self.result.warnings, [])

    def test_the_frontmatter_is_unchanged_at_the_top(self):
        self.assertTrue(
            self.result.rewritten_text.startswith(
                "---\ntitle: Release notes\nversion: 2.4\n---\n"
            )
        )

    def test_the_model_never_saw_markdown_structure(self):
        for sent in self.model.seen:
            self.assertNotIn("#", sent)
            self.assertNotIn("```", sent)
            self.assertNotIn("https://", sent)


class ChunkFallbackTest(unittest.TestCase):
    def test_a_chunk_that_fails_its_gate_keeps_its_original(self):
        def mangle_one(text):
            if "step forward" in text:
                return text.replace("step forward", "step forward, up 40%")
            return default_transform(text)

        result = humanize(ACCEPTANCE_MARKDOWN, FakeHumanizer(mangle_one))
        self.assertEqual(result.reverted_chunks, 1)
        self.assertIn(ACCEPTANCE_GENERIC_PROSE, result.rewritten_text)
        self.assertNotIn("40%", result.rewritten_text)
        self.assertIn("literal_invented", [w.code for w in result.warnings])
        # The rest of the document still got rewritten.
        self.assertTrue(result.preservation_passed)
        self.assertGreater(result.rewritten_chunks, 0)

    def test_a_model_that_returns_nothing_reverts_everything(self):
        result = humanize(ACCEPTANCE_MARKDOWN, FakeHumanizer(lambda text: ""))
        self.assertEqual(result.rewritten_text, ACCEPTANCE_MARKDOWN)
        self.assertEqual(result.rewritten_chunks, 0)
        self.assertEqual(result.reverted_chunks, result.total_chunks)
        self.assertTrue(result.preservation_passed)

    def test_a_model_that_echoes_its_input_changes_nothing(self):
        result = humanize(ACCEPTANCE_MARKDOWN, FakeHumanizer(lambda text: text))
        self.assertEqual(result.rewritten_text, ACCEPTANCE_MARKDOWN)

    def test_a_dropped_final_full_stop_is_restored_before_validation(self):
        source = "This formulaic sentence has enough words to rewrite safely.\n"
        result = humanize(source, FakeHumanizer(lambda text: text.rstrip(".")))
        self.assertEqual(result.rewritten_text, source)
        self.assertEqual(result.reverted_chunks, 0)
        self.assertEqual(result.warnings, [])

    def test_a_changed_visible_percentage_is_rejected(self):
        source = "The measured improvement was 18.5% across all tested systems.\n"
        result = humanize(
            source,
            FakeHumanizer(lambda text: text.replace("18.5%", "19%")),
        )
        self.assertEqual(result.rewritten_text, source)
        self.assertEqual(result.reverted_chunks, 1)
        self.assertIn("literal_removed", [warning.code for warning in result.warnings])
        self.assertIn("literal_invented", [warning.code for warning in result.warnings])

    def test_a_truncated_sentence_is_reverted_without_losing_other_rewrites(self):
        source = (
            "Lichens are composite organisms living in mutual dependence.\n\n"
            "The system represents a groundbreaking and transformative step forward.\n"
        )

        def truncate_one(text):
            if text.startswith("Lichens"):
                return "ehens" + text[len("Lichens") :]
            return default_transform(text)

        result = humanize(source, FakeHumanizer(truncate_one))
        self.assertIn("Lichens are composite organisms", result.rewritten_text)
        self.assertNotIn("ehens are", result.rewritten_text)
        self.assertIn("useful step forward", result.rewritten_text)
        self.assertEqual(result.reverted_chunks, 1)
        self.assertIn("truncated_word", [warning.code for warning in result.warnings])


class DocumentGateFailureTest(unittest.TestCase):
    """The second gate, and what the pipeline does when it fires.

    Getting every chunk past its own gate and still corrupting the document is
    hard by construction - a chunk that smuggles in a placeholder or a heading
    marker is caught one level down, as `test_a_chunk_that_fails_its_gate...`
    shows. So the failure is injected here: what is under test is the pipeline's
    response to a document-level refusal, not a way to provoke one.
    """

    def test_a_document_level_failure_offers_nothing(self):
        source = (
            "The first paragraph makes its own point clearly enough.\n\n"
            "The second paragraph makes a different point entirely.\n"
        )
        refusal = [Warning_(code="document_structure_changed", count=1)]
        with mock.patch(
            "breadboard_humanizer.pipeline.check_document", return_value=refusal
        ):
            result = humanize(source, FakeHumanizer())
        self.assertFalse(result.preservation_passed)
        # The original, untouched, rather than a rewrite nobody could vouch for.
        self.assertEqual(result.rewritten_text, source)
        self.assertEqual(result.rewritten_chunks, 0)
        self.assertEqual(result.reverted_chunks, result.total_chunks)
        self.assertIn("document_structure_changed", [w.code for w in result.warnings])

    def test_a_chunk_that_smuggles_a_placeholder_is_caught_one_level_down(self):
        source = (
            "The first paragraph makes its own point clearly enough.\n\n"
            "The second paragraph makes a different point entirely.\n"
        )

        def smuggle(text):
            return text + " XP0X" if "first" in text else text

        result = humanize(source, FakeHumanizer(smuggle))
        self.assertTrue(result.preservation_passed)
        self.assertEqual(result.reverted_chunks, 1)
        self.assertNotIn("XP", result.rewritten_text)


class BoundsTest(unittest.TestCase):
    def test_text_with_no_prose_at_all_is_returned_unchanged(self):
        source = "```py\nx = 1\n```\n"
        result = humanize(source, FakeHumanizer())
        self.assertEqual(result.rewritten_text, source)
        self.assertEqual(result.total_chunks, 0)

    def test_too_many_chunks_is_refused_rather_than_truncated(self):
        source = "\n\n".join(
            "Paragraph number %d says something worth rewriting." % index
            for index in range(500)
        )
        with self.assertRaises(PipelineError):
            humanize(source, FakeHumanizer())

    def test_cancellation_between_chunks_stops_the_run(self):
        model = FakeHumanizer()
        with self.assertRaises(CancelledError):
            humanize(ACCEPTANCE_MARKDOWN, model, should_cancel=lambda: True)
        self.assertEqual(model.seen, [])

    def test_chunks_respect_the_configured_token_budget(self):
        model = FakeHumanizer()
        long_paragraph = " ".join("Sentence number %d here." % index for index in range(60))
        humanize(long_paragraph, model, max_chunk_tokens=40, hard_ceiling=50)
        self.assertGreater(len(model.seen), 1)
        for sent in model.seen:
            self.assertLessEqual(model.count_tokens(sent), 50)


if __name__ == "__main__":
    unittest.main()
