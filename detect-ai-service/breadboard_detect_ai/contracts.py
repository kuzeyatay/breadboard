"""Stable JSON contracts shared by every detector adapter."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Modality = Literal["text", "image"]
Verdict = Literal[
    "likely_ai",
    "likely_human",
    "inconclusive",
    "insufficient_evidence",
    "error",
]
SignalStatus = Literal["ok", "skipped", "error"]


@dataclass(slots=True)
class DetectorSignal:
    detector_id: str
    detector_name: str
    modality: Modality
    status: SignalStatus
    verdict: Verdict
    raw_score: float | None = None
    raw_score_label: str | None = None
    threshold: float | None = None
    score_direction: Literal["higher_is_ai", "lower_is_ai"] | None = None
    calibrated_likelihood: float | None = None
    calibration_id: str | None = None
    evidence_strength: Literal["weak", "moderate", "strong"] = "weak"
    explanation: str = ""
    caveats: list[str] = field(default_factory=list)
    model_id: str | None = None
    model_revision: str | None = None
    device: str | None = None
    dtype: str | None = None
    token_count: int | None = None
    timing_ms: int | None = None
    error_code: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return _without_none(asdict(self))


@dataclass(slots=True)
class ProvenanceSignal:
    kind: str
    verdict: Literal["present", "absent", "unknown"]
    explanation: str
    fields: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return _without_none(asdict(self))


@dataclass(slots=True)
class DetectAIResult:
    schema_version: int
    request_id: str
    item_id: str
    name: str
    modality: Modality
    verdict: Verdict
    confidence: Literal["low", "medium", "high"]
    summary: str
    signals: list[DetectorSignal]
    provenance: list[ProvenanceSignal] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)
    degraded: bool = False
    timing_ms: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            **_without_none(asdict(self)),
            "signals": [signal.to_dict() for signal in self.signals],
            "provenance": [signal.to_dict() for signal in self.provenance],
        }


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}
