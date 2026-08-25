from __future__ import annotations

import base64
import binascii
import datetime as _dt
import hashlib
import threading
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


_IMAGE_IDENTITY_CHUNK_CHARS = 16 * 1024
_STORED_IMAGE_DETAILS = frozenset(("auto", "low", "high", "original"))


def _decoded_data_url_identity(url: Any) -> Dict[str, Any]:
    """Return a bounded-memory identity for a valid base64 data URL."""
    if not isinstance(url, str):
        return {}
    separator_index = url.find(",")
    header = url[:separator_index] if separator_index >= 0 else ""
    encoded_start = separator_index + 1
    encoded_length = len(url) - encoded_start
    if (
        separator_index < 0
        or not header.lower().startswith("data:")
        or "base64" not in {part.lower() for part in header[5:].split(";")[1:]}
        or encoded_length <= 0
        or encoded_length % 4 != 0
    ):
        return {}

    digest = hashlib.sha256()
    byte_length = 0
    try:
        for offset in range(encoded_start, len(url), _IMAGE_IDENTITY_CHUNK_CHARS):
            chunk = url[offset : offset + _IMAGE_IDENTITY_CHUNK_CHARS]
            if offset + len(chunk) < len(url) and "=" in chunk:
                return {}
            decoded = base64.b64decode(chunk, validate=True)
            digest.update(decoded)
            byte_length += len(decoded)
    except (binascii.Error, ValueError):
        return {}
    return {"sha256": digest.hexdigest(), "byteLength": byte_length}


def _stored_image_identity(part: Dict[str, Any]) -> Dict[str, Any]:
    """Allowlisted ledger identity; never retain an image URL or data payload."""
    image = part.get("image_url")
    url = image.get("url") if isinstance(image, dict) else image
    detail = image.get("detail") if isinstance(image, dict) else None
    identity: Dict[str, Any] = {"type": "image_url"}
    if isinstance(detail, str) and detail in _STORED_IMAGE_DETAILS:
        identity["detail"] = detail
    identity.update(_decoded_data_url_identity(url))
    return identity


def messages_for_council_run_snapshot(messages: List[ChatMessage]) -> List[ChatMessage]:
    """Copy messages for persistence, replacing images with safe identities.

    Text-only messages serialize exactly as before. The runtime retains and
    forwards the original CouncilInput messages; this copy exists only at the
    run snapshot boundary.
    """
    snapshot: List[ChatMessage] = []
    for message in messages:
        if not isinstance(message, dict):
            snapshot.append(message)
            continue
        content = message.get("content")
        if not isinstance(content, list):
            snapshot.append(dict(message))
            continue
        stored_content = [
            _stored_image_identity(part)
            if isinstance(part, dict) and part.get("type") == "image_url"
            else part
            for part in content
        ]
        snapshot.append({**message, "content": stored_content})
    return snapshot


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
    # Exact model id supplied by the client, including the `default` sentinel.
    requested_model_alias: Optional[str] = None
    # Public model selected when the request entered ChatMock.
    resolved_model: Optional[str] = None
    # Model used to route Council calls. Unlike the alias, this is expanded.
    requested_model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    reasoning_effort: Optional[str] = None
    reasoning_summary: Optional[str] = None
    # Recoverable requests must execute the exact resolved model once. They may
    # not substitute an unhealthy/missing provider or fail over after an error.
    strict_model_route: bool = False

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


@dataclass(frozen=True)
class CouncilTokenUsage:
    """Thread-safe CouncilRun usage snapshot across every attempted model call."""

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cached_input_tokens: int = 0
    reasoning_tokens: int = 0
    call_count: int = 0
    reported_call_count: int = 0

    @property
    def fully_reported(self) -> bool:
        return self.call_count > 0 and self.reported_call_count == self.call_count


@dataclass
class CouncilRun:
    id: str
    user_prompt: str
    messages: List[ChatMessage]
    council_mode: str
    requested_model: Optional[str] = None
    resolved_model: Optional[str] = None
    final_answer: str = ""
    reasoning_summary: str = ""
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
    _token_usage: CouncilTokenUsage = field(
        default_factory=CouncilTokenUsage,
        init=False,
        repr=False,
        compare=False,
    )
    _token_usage_lock: threading.Lock = field(
        default_factory=threading.Lock,
        init=False,
        repr=False,
        compare=False,
    )
    _model_attempts: List[Dict[str, Any]] = field(
        default_factory=list,
        init=False,
        repr=False,
        compare=False,
    )
    _model_attempts_lock: threading.Lock = field(
        default_factory=threading.Lock,
        init=False,
        repr=False,
        compare=False,
    )

    def record_model_call_usage(
        self,
        *,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        total_tokens: Optional[int] = None,
        cached_input_tokens: Optional[int] = None,
        reasoning_tokens: Optional[int] = None,
    ) -> None:
        """Record one attempted provider call and any usage it reported."""

        reported = input_tokens is not None and output_tokens is not None and total_tokens is not None
        with self._token_usage_lock:
            current = self._token_usage
            self._token_usage = CouncilTokenUsage(
                input_tokens=current.input_tokens + (input_tokens or 0),
                output_tokens=current.output_tokens + (output_tokens or 0),
                total_tokens=current.total_tokens + (total_tokens or 0),
                cached_input_tokens=current.cached_input_tokens + (cached_input_tokens or 0),
                reasoning_tokens=current.reasoning_tokens + (reasoning_tokens or 0),
                call_count=current.call_count + 1,
                reported_call_count=current.reported_call_count + (1 if reported else 0),
            )

    def token_usage_snapshot(self) -> CouncilTokenUsage:
        with self._token_usage_lock:
            return self._token_usage

    def record_model_attempts(self, attempts: List[Dict[str, Any]]) -> None:
        """Retain the exact provider/upstream route for every attempted call."""
        if not attempts:
            return
        with self._model_attempts_lock:
            self._model_attempts.extend(dict(attempt) for attempt in attempts)

    def model_attempts_snapshot(self) -> List[Dict[str, Any]]:
        with self._model_attempts_lock:
            return [dict(attempt) for attempt in self._model_attempts]

    def to_dict(self) -> Dict[str, Any]:
        usage = self.token_usage_snapshot()
        return {
            "id": self.id,
            "gardenId": self.garden_id,
            "pageId": self.page_id,
            "userPrompt": self.user_prompt,
            "messages": messages_for_council_run_snapshot(self.messages),
            "taskType": self.task_type,
            "councilMode": self.council_mode,
            "requestedModel": self.requested_model,
            "resolvedModel": self.resolved_model,
            "modelRouting": self.model_attempts_snapshot(),
            "sourceContext": self.source_context,
            "candidates": [c.to_dict() for c in self.candidates],
            "reviews": [r.to_dict() for r in self.reviews],
            "aggregateRanking": self.aggregate_ranking.to_dict() if self.aggregate_ranking else None,
            "finalAnswer": self.final_answer,
            "reasoningSummary": self.reasoning_summary or None,
            "diagnostics": self.diagnostics or None,
            "usage": {
                "inputTokens": usage.input_tokens,
                "outputTokens": usage.output_tokens,
                "totalTokens": usage.total_tokens,
                "cachedInputTokens": usage.cached_input_tokens,
                "reasoningTokens": usage.reasoning_tokens,
                "callCount": usage.call_count,
                "reportedCallCount": usage.reported_call_count,
            },
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
            "reasoningSummary": self.reasoning_summary or None,
            "requestedModel": self.requested_model,
            "resolvedModel": self.resolved_model,
            "modelRouting": self.model_attempts_snapshot(),
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
