"""Conservative aggregation without cross-detector score arithmetic."""

from __future__ import annotations

from .contracts import DetectorSignal, Verdict


def aggregate(signals: list[DetectorSignal]) -> tuple[Verdict, str, bool, str]:
    usable = [signal for signal in signals if signal.status == "ok"]
    degraded = any(signal.status == "error" for signal in signals)
    if not usable:
        if any(signal.verdict == "insufficient_evidence" for signal in signals):
            return (
                "insufficient_evidence",
                "low",
                degraded,
                "There is not enough usable evidence for a detector verdict.",
            )
        return "error", "low", True, "No detector produced a usable signal."

    decisive = [signal for signal in usable if signal.verdict in {"likely_ai", "likely_human"}]
    opinions = {signal.verdict for signal in decisive}
    if len(opinions) > 1:
        return (
            "inconclusive",
            "low",
            degraded,
            "The available detectors disagree, so Breadboard is not choosing a side.",
        )
    if not decisive:
        return (
            "inconclusive",
            "low",
            degraded,
            "The detector scores are too close to their decision boundaries.",
        )

    verdict = decisive[0].verdict
    if len(decisive) >= 2 and all(signal.evidence_strength == "strong" for signal in decisive):
        confidence = "high"
    elif any(signal.evidence_strength in {"moderate", "strong"} for signal in decisive):
        confidence = "medium"
    else:
        confidence = "low"
    if degraded:
        confidence = "low"
    label = "AI-generated" if verdict == "likely_ai" else "human-authored"
    qualifier = "All usable detectors" if len(decisive) > 1 else decisive[0].detector_name
    summary = f"{qualifier} found the item more consistent with {label} material."
    if degraded:
        summary += " One or more requested detectors failed, so this is a degraded result."
    return verdict, confidence, degraded, summary
