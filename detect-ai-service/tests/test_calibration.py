import unittest

from breadboard_detect_ai.aggregate import aggregate
from breadboard_detect_ai.calibration import (
    binoculars_signal,
    fast_detect_signal,
    universal_fake_detect_signal,
)
from breadboard_detect_ai.contracts import DetectorSignal


class CalibrationTests(unittest.TestCase):
    def test_fast_detect_only_exposes_likelihood_for_exact_profile(self):
        calibrated = fast_detect_signal(
            2.9,
            profile="falcon-7b__falcon-7b-instruct",
            model_id="pair",
            revision="pinned",
            device="cpu",
            dtype="bfloat16",
            token_count=200,
            timing_ms=1,
        )
        unknown = fast_detect_signal(
            2.9,
            profile="unknown",
            model_id="pair",
            revision="pinned",
            device="cpu",
            dtype="bfloat16",
            token_count=200,
            timing_ms=1,
        )
        self.assertIsNotNone(calibrated.calibrated_likelihood)
        self.assertIsNone(unknown.calibrated_likelihood)
        self.assertEqual(unknown.verdict, "inconclusive")

    def test_binoculars_uses_direction_and_uncertainty_band(self):
        common = dict(
            mode="low-fpr",
            model_id="pair",
            revision="pinned",
            device="cpu",
            dtype="bfloat16",
            token_count=200,
            timing_ms=1,
        )
        self.assertEqual(binoculars_signal(0.7, **common).verdict, "likely_ai")
        self.assertEqual(binoculars_signal(1.0, **common).verdict, "likely_human")
        self.assertEqual(binoculars_signal(0.85, **common).verdict, "inconclusive")
        self.assertIsNone(binoculars_signal(0.7, **common).calibrated_likelihood)

    def test_image_sigmoid_is_not_presented_as_probability(self):
        signal = universal_fake_detect_signal(
            0.91,
            model_id="clip",
            revision="pinned",
            device="cpu",
            dtype="float32",
            timing_ms=1,
        )
        self.assertEqual(signal.verdict, "likely_ai")
        self.assertIsNone(signal.calibrated_likelihood)
        self.assertIn("not a calibrated probability", " ".join(signal.caveats))

    def test_disagreement_is_inconclusive_not_average(self):
        signals = [
            DetectorSignal("a", "A", "text", "ok", "likely_ai", evidence_strength="strong"),
            DetectorSignal("b", "B", "text", "ok", "likely_human", evidence_strength="strong"),
        ]
        verdict, confidence, degraded, _ = aggregate(signals)
        self.assertEqual(verdict, "inconclusive")
        self.assertEqual(confidence, "low")
        self.assertFalse(degraded)

    def test_single_detector_failure_is_degraded(self):
        signals = [
            DetectorSignal("a", "A", "text", "error", "error"),
            DetectorSignal("b", "B", "text", "ok", "likely_ai", evidence_strength="strong"),
        ]
        verdict, confidence, degraded, summary = aggregate(signals)
        self.assertEqual(verdict, "likely_ai")
        self.assertEqual(confidence, "low")
        self.assertTrue(degraded)
        self.assertIn("degraded", summary)


if __name__ == "__main__":
    unittest.main()
