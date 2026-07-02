from __future__ import annotations

import datetime as _dt
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# OpenAI-style chat message: {"role": "...", "content": "..." | [content parts]}
ChatMessage = Dict[str, Any]

COUNCIL_MODES = (
    "direct_council",
    "lite_council",
    "full_council",
    "evolution_council",
)

EVOLUTION_ARTIFACT_TYPES = (
    "prompt",
    "section",
    "visual_block",
    "topic_map",
    "critique_policy",
    "page_assistant_policy",
)


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def message_text(content: Any) -> str:
    """Extract plain text from an OpenAI chat message content value."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for part in content:
            if isinstance(part, dict):
                if isinstance(part.get("text"), str):
                    parts.append(part["text"])
                elif part.get("type") == "image_url":
                    parts.append("[image attachment]")
        return "\n".join(parts)
    return ""


def messages_text(messages: List[ChatMessage]) -> str:
    lines: List[str] = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "user")
        lines.append(f"{role}: {message_text(msg.get('content'))}")
    return "\n\n".join(lines)


def last_user_text(messages: List[ChatMessage]) -> str:
    for msg in reversed(messages or []):
        if isinstance(msg, dict) and msg.get("role") == "user":
            return message_text(msg.get("content"))
    return ""


@dataclass
class CouncilInput:
    messages: List[ChatMessage]
    user_prompt: str = ""
    task_type: Optional[str] = None
    council_mode_override: Optional[str] = None
    garden_id: Optional[str] = None
    page_id: Optional[str] = None
    source_context: Any = None
    include_diagnostics: bool = False
    requested_model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None

    def __post_init__(self) -> None:
        if not self.user_prompt:
            self.user_prompt = last_user_text(self.messages)


@dataclass
class CouncilCandidate:
    id: str
    model: str
    content: str
    anonymized_id: Optional[str] = None
    role: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "model": self.model,
            "anonymizedId": self.anonymized_id,
            "role": self.role,
            "content": self.content,
            "metadata": self.metadata,
        }


@dataclass
class CouncilReview:
    id: str
    reviewer_model: str
    critique: str
    reviewer_role: Optional[str] = None
    anonymized_candidate_ids: List[str] = field(default_factory=list)
    rankings: Optional[List[str]] = None
    scores: Optional[Dict[str, float]] = None
    recommended_winner_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "reviewerModel": self.reviewer_model,
            "reviewerRole": self.reviewer_role,
            "anonymizedCandidateIds": self.anonymized_candidate_ids,
            "rankings": self.rankings,
            "scores": self.scores,
            "critique": self.critique,
            "recommendedWinnerId": self.recommended_winner_id,
        }


@dataclass
class AggregateRanking:
    ordered_candidate_ids: List[str]
    score_by_candidate_id: Dict[str, float]
    explanation: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "orderedCandidateIds": self.ordered_candidate_ids,
            "scoreByCandidateId": self.score_by_candidate_id,
            "explanation": self.explanation,
        }


@dataclass
class CouncilRun:
    id: str
    user_prompt: str
    messages: List[ChatMessage]
    council_mode: str
    final_answer: str = ""
    garden_id: Optional[str] = None
    page_id: Optional[str] = None
    task_type: Optional[str] = None
    source_context: Any = None
    candidates: List[CouncilCandidate] = field(default_factory=list)
    reviews: List[CouncilReview] = field(default_factory=list)
    aggregate_ranking: Optional[AggregateRanking] = None
    diagnostics: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=now_iso)
    updated_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "gardenId": self.garden_id,
            "pageId": self.page_id,
            "userPrompt": self.user_prompt,
            "messages": self.messages,
            "taskType": self.task_type,
            "councilMode": self.council_mode,
            "sourceContext": self.source_context,
            "candidates": [c.to_dict() for c in self.candidates],
            "reviews": [r.to_dict() for r in self.reviews],
            "aggregateRanking": self.aggregate_ranking.to_dict() if self.aggregate_ranking else None,
            "finalAnswer": self.final_answer,
            "diagnostics": self.diagnostics or None,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }

    def diagnostics_dict(self) -> Dict[str, Any]:
        """The debugging payload exposed when includeCouncilDiagnostics is true."""
        return {
            "candidates": [c.to_dict() for c in self.candidates],
            "reviews": [r.to_dict() for r in self.reviews],
            "aggregateRanking": self.aggregate_ranking.to_dict() if self.aggregate_ranking else None,
            "finalAnswer": self.final_answer,
        }


@dataclass
class EvolutionNode:
    id: str
    artifact_type: str
    artifact_snapshot: Any
    mutation_description: str
    council_run_id: str
    evaluation_scores: Dict[str, float] = field(default_factory=dict)
    status: str = "candidate"  # candidate | rejected | promoted | archived
    parent_id: Optional[str] = None
    garden_id: Optional[str] = None
    page_id: Optional[str] = None
    created_at: str = field(default_factory=now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "parentId": self.parent_id,
            "gardenId": self.garden_id,
            "pageId": self.page_id,
            "artifactType": self.artifact_type,
            "artifactSnapshot": self.artifact_snapshot,
            "mutationDescription": self.mutation_description,
            "councilRunId": self.council_run_id,
            "evaluationScores": self.evaluation_scores,
            "status": self.status,
            "createdAt": self.created_at,
        }
