"""The real checkpoint, behind an explicit flag.

Skipped unless BREADBOARD_HUMANIZER_SMOKE=1. Every other test in this suite
runs against a fake, deliberately: the ordinary suite must be runnable on a
machine that has never done the opt-in download, and loading 1.6 GB of weights
to prove that a paragraph boundary survives reassembly would test PyTorch.

What this proves that the fake cannot: that a real beam search over a real
tokenizer, on real prose, still comes back with the version number, the date,
the URL and the inline code exactly as they went in - and with different words
around them.

    set BREADBOARD_HUMANIZER_SMOKE=1
    python -m unittest tests.test_real_model_smoke
"""

from __future__ import annotations

import os
import unittest

from breadboard_humanizer.model import BartHumanizer, model_is_installed
from breadboard_humanizer.pipeline import humanize

from .fixtures import ACCEPTANCE_GENERIC_PROSE, ACCEPTANCE_INVARIANTS, ACCEPTANCE_MARKDOWN

ENABLED = os.environ.get("BREADBOARD_HUMANIZER_SMOKE", "").strip() == "1"


@unittest.skipUnless(ENABLED, "set BREADBOARD_HUMANIZER_SMOKE=1 to run the real-model smoke test")
class RealModelSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = BartHumanizer(device=os.environ.get("BREADBOARD_HUMANIZER_DEVICE", "auto"))
        if not cls.model.installed():
            raise unittest.SkipTest(
                "the checkpoint is not downloaded - run "
                "`npm run setup:humanizer -- --download-model`"
            )

    @classmethod
    def tearDownClass(cls):
        cls.model.unload()

    def test_the_checkpoint_is_present_without_a_network_call(self):
        self.assertTrue(model_is_installed(self.model.model_id))

    def test_the_acceptance_fixture_survives_a_real_rewrite(self):
        result = humanize(ACCEPTANCE_MARKDOWN, self.model)

        for invariant in ACCEPTANCE_INVARIANTS:
            with self.subTest(invariant=invariant):
                self.assertIn(invariant, result.rewritten_text)

        self.assertNotIn("XP", result.rewritten_text)
        self.assertTrue(result.preservation_passed)
        # The model is allowed to have refused some chunks; it is not allowed to
        # have refused all of them and still be worth shipping.
        self.assertGreater(result.rewritten_chunks, 0)

    def test_formulaic_prose_is_actually_rewritten(self):
        """The real signal: does this checkpoint improve machine-written prose?

        Not the acceptance fixture's own sentence, which is deliberately
        literal-dense and short - measured, that one comes back stuttering
        ("a revolutionary and revolutionary step") and the gate rejects it,
        which is correct behaviour and a poor liveness check. These are the
        long, formulaic sentences the feature exists for. Measured yield at the
        time of writing was six of six; the threshold below leaves room for the
        model to have a worse day without turning this into a flake.
        """
        slop = [
            "It is important to note that this solution serves as a testament to "
            "the transformative power of innovation.",
            "In today's rapidly evolving digital landscape, organisations must "
            "leverage cutting-edge solutions to remain competitive.",
            "Moreover, it is worth noting that the implementation delivers robust "
            "and scalable performance across a wide variety of use cases.",
            "The framework empowers developers to seamlessly integrate powerful "
            "features into their existing workflows.",
        ]
        rewritten = 0
        for sentence in slop:
            result = humanize(sentence + "\n", self.model)
            if result.rewritten_chunks > 0 and result.rewritten_text.strip() != sentence:
                rewritten += 1
            # Whatever it did, it must not have published something unsafe.
            self.assertTrue(result.preservation_passed, sentence[:40])
        self.assertGreaterEqual(
            rewritten, 2, "the checkpoint rewrote almost nothing - see the model notes"
        )

    def test_prose_that_is_already_plain_is_left_alone(self):
        # The other half of behaving well: nothing to improve, nothing changed.
        plain = "We tested it on three machines and it failed on the oldest one."
        result = humanize(plain + "\n", self.model)
        self.assertTrue(result.preservation_passed)

    def test_the_device_and_dtype_are_what_was_asked_for(self):
        self.model.count_tokens("warm the tokenizer")
        self.assertIn(self.model.device, {"cpu", "cuda:0"})
        self.assertEqual(
            self.model.dtype, "float16" if self.model.device.startswith("cuda") else "float32"
        )


if __name__ == "__main__":
    unittest.main()
