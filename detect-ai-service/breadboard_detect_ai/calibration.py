"""Detector-specific calibration and evidence aggregation.

The values here retain the meaning given by each upstream implementation.
Scores from different detectors never share a scale and are never averaged.
"""

from __future__ import annotations

import math
from dataclasses import replace

from .contracts import DetectorSignal

FAST_DETECT_GPT_PROFILES: dict[str, tuple[float, float, float, float]] = {
    "gpt-j-6B__gpt-neo-2.7B": (0.2713, 0.9366, 2.2334, 1.8731),
    "gpt-neo-2.7B__gpt-neo-2.7B": (-0.2489, 0.9968, 1.8983, 1.9935),
    "falcon-7b__falcon-7b-instruct": (-0.0707, 0.9520, 2.9306, 1.9039),
    "llama3-8b__llama3-8b-instruct": (0.1603, 1.0791, 2.4686, 2.1582),
}

BINOCULARS_THRESHOLDS = {
    "accuracy": 0.9015310749276843,
    "low-fpr": 0.8536432310785527,
}


def _normal_pdf(value: float, mean: float, sigma: float) -> float:
    return math.exp(-((value - mean) ** 2) / (2 * sigma**2)) / (
        math.sqrt(2 * math.pi) * sigma
    )


def fast_detect_signal(
    score: float,
    *,
    profile: str,
    model_id: str,
    revision: str,
    device: str,
    dtype: str,
    token_count: int,
    timing_ms: int,
) -> DetectorSignal:
    calibration = FAST_DETECT_GPT_PROFILES.get(profile)
    if not calibration:
        return DetectorSignal(
            detector_id="fast_detect_gpt",
            detector_name="Fast-DetectGPT",
            modality="text",
            status="ok",
            verdict="inconclusive",
            raw_score=score,
            raw_score_label="sampling discrepancy",
            score_direction="higher_is_ai",
            explanation="The analytic discrepancy was computed, but this model pair has no registered calibration.",
            caveats=["An uncalibrated raw score is not a probability."],
            model_id=model_id,
            model_revision=revision,
            device=device,
            dtype=dtype,
            token_count=token_count,
            timing_ms=timing_ms,
        )

    mu_human, sigma_human, mu_ai, sigma_ai = calibration
    p_human = _normal_pdf(score, mu_human, sigma_human)
    p_ai = _normal_pdf(score, mu_ai, sigma_ai)
    likelihood = p_ai / (p_ai + p_human) if p_ai + p_human else 0.5
    distance = abs(likelihood - 0.5)
    if likelihood >= 0.72:
        verdict = "likely_ai"
    elif likelihood <= 0.28:
        verdict = "likely_human"
    else:
        verdict = "inconclusive"
    strength = "strong" if distance >= 0.42 else "moderate" if distance >= 0.24 else "weak"
    return DetectorSignal(
        detector_id="fast_detect_gpt",
        detector_name="Fast-DetectGPT",
        modality="text",
        status="ok",
        verdict=verdict,
        raw_score=score,
        raw_score_label="sampling discrepancy",
        score_direction="higher_is_ai",
        calibrated_likelihood=likelihood,
        calibration_id=f"fast-detect-gpt:{profile}:upstream-normal-fit",
        evidence_strength=strength,
        explanation=(
            "Compared the observed token likelihood with the reference model's expected likelihood, "
            "then applied the upstream normal-fit calibration for this exact model pair."
        ),
        caveats=[
            "The displayed likelihood is a model-estimated likelihood under a balanced calibration prior, not proof of authorship."
        ],
        model_id=model_id,
        model_revision=revision,
        device=device,
        dtype=dtype,
        token_count=token_count,
        timing_ms=timing_ms,
    )


def binoculars_signal(
    score: float,
    *,
    mode: str,
    model_id: str,
    revision: str,
    device: str,
    dtype: str,
    token_count: int,
    timing_ms: int,
) -> DetectorSignal:
    threshold = BINOCULARS_THRESHOLDS[mode]
    relative_margin = (score - threshold) / threshold
    if relative_margin <= -0.08:
        verdict, strength = "likely_ai", "strong"
    elif relative_margin <= -0.025:
        verdict, strength = "likely_ai", "moderate"
    elif relative_margin >= 0.08:
        verdict, strength = "likely_human", "strong"
    elif relative_margin >= 0.025:
        verdict, strength = "likely_human", "moderate"
    else:
        verdict, strength = "inconclusive", "weak"
    return DetectorSignal(
        detector_id="binoculars",
        detector_name="Binoculars",
        modality="text",
        status="ok",
        verdict=verdict,
        raw_score=score,
        raw_score_label="perplexity / cross-perplexity",
        threshold=threshold,
        score_direction="lower_is_ai",
        calibration_id=f"binoculars:falcon-7b:{mode}",
        evidence_strength=strength,
        explanation=(
            f"Compared the Binoculars ratio with its upstream {mode} threshold. "
            "A lower score is more consistent with machine-generated text."
        ),
        caveats=["The ratio and its distance from the threshold are not probabilities."],
        model_id=model_id,
        model_revision=revision,
        device=device,
        dtype=dtype,
        token_count=token_count,
        timing_ms=timing_ms,
    )


def universal_fake_detect_signal(
    score: float,
    *,
    model_id: str,
    revision: str,
    device: str,
    dtype: str,
    timing_ms: int,
) -> DetectorSignal:
    distance = abs(score - 0.5)
    if score >= 0.65:
        verdict = "likely_ai"
    elif score <= 0.35:
        verdict = "likely_human"
    else:
        verdict = "inconclusive"
    strength = "strong" if distance >= 0.35 else "moderate" if distance >= 0.15 else "weak"
    return DetectorSignal(
        detector_id="universal_fake_detect",
        detector_name="UniversalFakeDetect",
        modality="image",
        status="ok",
        verdict=verdict,
        raw_score=score,
        raw_score_label="sigmoid classifier score",
        threshold=0.5,
        score_direction="higher_is_ai",
        calibration_id="universalfakedetect:clip-vit-l14:upstream-0.5-threshold",
        evidence_strength=strength,
        explanation="Applied the upstream linear head to the frozen CLIP ViT-L/14 image representation.",
        caveats=[
            "The sigmoid output is a classifier score, not a calibrated probability.",
            "Edits, screenshots, compression, and generators outside the training distribution can change the score.",
        ],
        model_id=model_id,
        model_revision=revision,
        device=device,
        dtype=dtype,
        timing_ms=timing_ms,
    )


def with_language_caveat(signal: DetectorSignal, language: str) -> DetectorSignal:
    if language == "likely_english":
        return signal
    return replace(
        signal,
        caveats=[
            *signal.caveats,
            "This detector was primarily validated on English; this text appears non-English or mixed-language.",
        ],
        evidence_strength="weak" if signal.evidence_strength == "moderate" else signal.evidence_strength,
    )
