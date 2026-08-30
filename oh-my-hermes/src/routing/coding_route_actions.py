from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from .executor_cues import (
    NAMED_CODING_AGENT_PHRASES,
    OMO_RUNTIME_CODING_AGENT_PHRASES,
    contains_boundary_phrase,
)
from .localization import normalized_phrase


CODING_ROUTE_DECISION_SCHEMA_VERSION = "coding_route_decision/v1"

# Every coding-delivery route hint reports the same lane action. The lane action says
# "prepare one bounded delivery cycle"; it deliberately says nothing about who owns the
# code. Owner state lives in the decision below so the two questions stop sharing one
# ambiguous label.
CODING_ROUTE_LANE_NEXT_ACTION = "prepare_one_cycle_delivery"

# The four coding-owner states. They are distinct on purpose: before this vocabulary a
# named executor, a recorded setup preference, a request-led compatible route, and a real
# "we cannot decide this safely" fallback all collapsed into `choose_executor`, which reads
# either as "Hermes picks" or as "the user must pick".
NAMED_EXECUTOR_NEXT_ACTION = "prepare_named_executor_handoff"
RECORDED_OWNER_NEXT_ACTION = "prepare_recorded_owner_handoff"
COMPATIBLE_ROUTE_NEXT_ACTION = "prepare_compatible_route_handoff"
USER_CHOICE_NEXT_ACTION = "choose_executor"

CODING_ROUTE_NEXT_ACTIONS: tuple[str, ...] = (
    NAMED_EXECUTOR_NEXT_ACTION,
    RECORDED_OWNER_NEXT_ACTION,
    COMPATIBLE_ROUTE_NEXT_ACTION,
    USER_CHOICE_NEXT_ACTION,
)

CODING_ROUTE_DECISION_SOURCES: tuple[str, ...] = (
    "request_named_executor",
    "recorded_setup_preference",
    "request_capability_match",
    "user_choice_required",
)

# Owner ids reuse the executor profile ids the handoff builders already understand.
# The phrase groups partition `NAMED_CODING_AGENT_PHRASES` from the executor-name policy
# so both surfaces recognise exactly the same names.
NAMED_EXECUTOR_OWNER_PHRASES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("codex", ("codex", "코덱스")),
    (
        "claude-code",
        ("claude code", "claude-code", "claudecode", "클로드 코드", "클로드코드"),
    ),
    (
        "hermes",
        ("hermes coding", "헤르메스 코딩", "헤르메스가 코딩", "헤르메스한테 코딩"),
    ),
    # One owner covers every omo host CLI (pi, senpi, opencode); the phrase
    # policy for pi lives with `OMO_RUNTIME_CODING_AGENT_PHRASES` in
    # `routing/executor_cues.py` (bare "pi" belongs to Raspberry-Pi routing).
    # The tuple is shared, not copied, so this group and the policy-level
    # executor names cannot drift apart.
    ("omo-runtime", OMO_RUNTIME_CODING_AGENT_PHRASES),
)

# Owner groups whose phrases hide inside ordinary words as raw substrings
# ("promo runtime" contains "omo runtime", "api한테" contains "pi한테"). These
# groups are matched with `contains_boundary_phrase`; every other group keeps
# plain containment.
_BOUNDARY_MATCHED_OWNERS: frozenset[str] = frozenset({"omo-runtime"})

# Request-led compatible routes. These cues name the *shape* of the coding owner the
# request needs, never a vendor, so Hermes can pick a compatible route family without
# reopening the picker and without making any single agent the implicit default.
PROMPT_ONLY_ROUTE_PHRASES: tuple[str, ...] = (
    "prompt only",
    "prompt-only",
    "just the prompt",
    "give me the prompt",
    "copy the prompt",
    "paste the prompt",
    "프롬프트만",
    "프롬프트로만",
    "프롬프트 복사",
    "プロンプトのみ",
    "只要提示词",
)
RUNTIME_ROUTE_PHRASES: tuple[str, ...] = (
    "parallel workers",
    "worker lanes",
    "team of workers",
    "in a worktree",
    "separate worktree",
    "worktree per",
    "워크트리",
    "병렬 워커",
    "워커 레인",
    "ワークツリー",
    "工作树",
)

COMPATIBLE_ROUTE_FAMILIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("prompt_only_handoff", PROMPT_ONLY_ROUTE_PHRASES),
    ("runtime_handoff", RUNTIME_ROUTE_PHRASES),
)

# Authority/policy cues. When the request reaches for merge, release, production, or
# credential authority, automatic selection is unsafe no matter how clear the capability
# cue is, so the explicit user-choice path is kept.
UNSAFE_AUTOMATIC_SELECTION_PHRASES: tuple[str, ...] = (
    "merge it yourself",
    "merge to main",
    "merge into main",
    "push to production",
    "deploy to production",
    "force push",
    "rotate the credentials",
    "production database",
    "메인에 머지",
    "프로덕션에 배포",
    "강제 푸시",
    "合并到 main",
    "推送到生产",
)

RECORDED_OWNER_UNSET_VALUES: frozenset[str] = frozenset({"", "choose"})

CODING_ROUTE_DECISION_CLAIM_BOUNDARY = (
    "A coding route decision selects a prepared handoff shape only. It is not executor dispatch, "
    "implementation, review, CI, merge-readiness, or merge evidence."
)


@dataclass(frozen=True)
class CodingRouteDecision:
    """One coding-owner decision shared by the chat wrapper and the plugin route hints."""

    next_action: str
    source: str
    reason: str
    confidence: str
    choice_required: bool
    selected_owner: str = ""
    selected_route_family: str = ""
    matched_cues: tuple[str, ...] = ()


def resolve_coding_route_decision(
    normalized_query: str,
    *,
    requested_owner: str = "",
    recorded_owner: str = "",
) -> CodingRouteDecision:
    """Return the coding-owner state for an already-normalized coding request.

    `normalized_query` must come from `normalized_phrase` so the chat wrapper and the
    plugin route hints match executor names and capability cues on the same folded text.
    `requested_owner` is an owner the caller already fixed in the request envelope (for
    example `--executor codex`); `recorded_owner` is the persisted setup preference.
    """
    owners = named_executor_owners(normalized_query)
    unsafe = _matched_phrases(normalized_query, UNSAFE_AUTOMATIC_SELECTION_PHRASES)

    normalized_requested_owner = str(requested_owner or "").strip().casefold()
    if normalized_requested_owner and normalized_requested_owner not in RECORDED_OWNER_UNSET_VALUES and not unsafe:
        return CodingRouteDecision(
            next_action=NAMED_EXECUTOR_NEXT_ACTION,
            source="request_named_executor",
            reason=f"The request already fixes `{normalized_requested_owner}` as the coding owner, so no picker is needed.",
            confidence="high",
            choice_required=False,
            selected_owner=normalized_requested_owner,
            matched_cues=("requested_executor_target",),
        )

    if len(owners) == 1 and not unsafe:
        owner = owners[0]
        return CodingRouteDecision(
            next_action=NAMED_EXECUTOR_NEXT_ACTION,
            source="request_named_executor",
            reason=f"The request names `{owner}` as the coding owner, so no picker is needed.",
            confidence="high",
            choice_required=False,
            selected_owner=owner,
            matched_cues=(f"named_executor:{owner}",),
        )
    if len(owners) > 1:
        return CodingRouteDecision(
            next_action=USER_CHOICE_NEXT_ACTION,
            source="user_choice_required",
            reason="The request names more than one coding agent, so the user has to say which one owns the work.",
            confidence="low",
            choice_required=True,
            matched_cues=tuple(f"named_executor:{owner}" for owner in owners),
        )
    if unsafe:
        return CodingRouteDecision(
            next_action=USER_CHOICE_NEXT_ACTION,
            source="user_choice_required",
            reason="The request reaches for merge, release, production, or credential authority, so the coding owner stays an explicit user choice.",
            confidence="low",
            choice_required=True,
            matched_cues=tuple(unsafe),
        )

    normalized_recorded_owner = str(recorded_owner or "").strip().casefold()
    if normalized_recorded_owner and normalized_recorded_owner not in RECORDED_OWNER_UNSET_VALUES:
        return CodingRouteDecision(
            next_action=RECORDED_OWNER_NEXT_ACTION,
            source="recorded_setup_preference",
            reason=f"A recorded setup preference already names `{normalized_recorded_owner}` as the coding owner.",
            confidence="high",
            choice_required=False,
            selected_owner=normalized_recorded_owner,
            matched_cues=("recorded_setup_preference",),
        )

    family, family_cues = _compatible_route_family(normalized_query)
    if family:
        return CodingRouteDecision(
            next_action=COMPATIBLE_ROUTE_NEXT_ACTION,
            source="request_capability_match",
            reason=f"The request names the coding owner shape it needs, so the `{family}` route family is compatible without a picker.",
            confidence="medium",
            choice_required=False,
            selected_route_family=family,
            matched_cues=family_cues,
        )

    return CodingRouteDecision(
        next_action=USER_CHOICE_NEXT_ACTION,
        source="user_choice_required",
        reason="No named executor, recorded preference, or capability cue resolves the coding owner, so the user picks.",
        confidence="low",
        choice_required=True,
        matched_cues=(),
    )


def named_executor_owners(normalized_query: str) -> tuple[str, ...]:
    """Return the distinct executor profile ids named in an already-normalized request."""
    owners: list[str] = []
    for owner, phrases in NAMED_EXECUTOR_OWNER_PHRASES:
        if owner in _BOUNDARY_MATCHED_OWNERS:
            matched = contains_boundary_phrase(normalized_query, _normalized_options(phrases))
        else:
            matched = bool(_matched_phrases(normalized_query, phrases))
        if matched:
            owners.append(owner)
    return tuple(owners)


def coding_route_decision_payload(decision: CodingRouteDecision) -> dict[str, object]:
    """Return the wrapper-facing, machine-readable form of one coding route decision."""
    return {
        "schema_version": CODING_ROUTE_DECISION_SCHEMA_VERSION,
        "next_action": decision.next_action,
        "source": decision.source,
        "reason": decision.reason,
        "confidence": decision.confidence,
        "choice_required": decision.choice_required,
        "selected_owner": decision.selected_owner,
        "selected_route_family": decision.selected_route_family,
        "matched_cues": list(decision.matched_cues),
        "lane_next_action": CODING_ROUTE_LANE_NEXT_ACTION,
        "user_choice_next_action": USER_CHOICE_NEXT_ACTION,
        "claim_boundary": CODING_ROUTE_DECISION_CLAIM_BOUNDARY,
    }


def user_choice_coding_route_decision(reason: str) -> CodingRouteDecision:
    """Return the retained fallback state for hosts that cannot resolve a decision."""
    return CodingRouteDecision(
        next_action=USER_CHOICE_NEXT_ACTION,
        source="user_choice_required",
        reason=reason,
        confidence="low",
        choice_required=True,
    )


def _compatible_route_family(normalized_query: str) -> tuple[str, tuple[str, ...]]:
    matches: list[tuple[str, tuple[str, ...]]] = []
    for family, phrases in COMPATIBLE_ROUTE_FAMILIES:
        cues = _matched_phrases(normalized_query, phrases)
        if cues:
            matches.append((family, cues))
    if len(matches) != 1:
        # Zero cues means nothing to match; two families means the request asks for both
        # shapes at once, which is a user choice rather than an automatic route.
        return "", ()
    return matches[0]


def _matched_phrases(normalized_query: str, phrases: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(phrase for phrase in _normalized_options(phrases) if phrase in normalized_query)


@lru_cache(maxsize=256)
def _normalized_options(phrases: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(folded for folded in (normalized_phrase(phrase) for phrase in phrases) if folded)


def named_coding_agent_phrase_parity() -> bool:
    """True when the owner phrase groups still cover the policy-level executor names."""
    grouped = {phrase for _owner, phrases in NAMED_EXECUTOR_OWNER_PHRASES for phrase in phrases}
    return grouped == set(NAMED_CODING_AGENT_PHRASES)
