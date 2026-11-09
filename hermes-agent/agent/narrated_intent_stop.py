"""Turn-end guard for narrated-intent stops.

Models sometimes answer a request with only an announcement of what they are
about to do ("I'll review the material and put together an outline.") and
then stop with ``finish_reason=stop`` and no tool calls. Nothing was done, but
every surface renders that sentence as the finished answer.

This module is policy-only: when a turn is about to end on such a reply,
return a bounded synthetic nudge so the conversation loop continues and the
model carries the work out instead of exiting. The same shape as
``agent.kanban_stop``; wired next to it in ``conversation_loop``.
"""

from __future__ import annotations

import os
import re
from typing import Optional

_DEFAULT_MAX_ATTEMPTS = 2
_MAX_WORDS = 70

# First-person "about to act" phrasing. Any verb counts: a fixed verb list
# missed "I'll use the lecture list to propose a study order" live. Sign-offs
# such as "I'll be here if you need anything" are excluded by _LEGIT_STOP.
_INTENT = re.compile(
    r"\b(?:i['’]ll|i will|i['’]m going to|i am going to|let me|i['’]m about to|"
    r"i['’]m now going to|i will now|i['’]ll now|"
    r"i['’]m (?:now )?(?:starting|working|looking|checking|reviewing|gathering|pulling|going))\b",
    re.IGNORECASE,
)

# Phrasing that marks a legitimate conversational stop, not unfinished work.
_LEGIT_STOP = re.compile(
    r"\?|\blet me know\b|\bfeel free\b|\bif you (?:need|want|have|prefer|would)\b|\banything else\b|"
    r"\bhappy to\b|\bhope (?:this|that) helps\b|\bi (?:can['’]t|cannot|won['’]t|am unable|['’]m unable)\b|"
    r"\bshall i\b|\bshould i\b|\bwould you like\b|\bdo you want\b|\bwhich (?:one|option)\b|"
    r"\bi['’]ll be (?:here|around|happy|glad|available)\b|\bi will be (?:here|around|happy|glad|available)\b|"
    # Work handed to a team/worker/job that will wake the chat later is a
    # legitimate end of turn, not an unfinished answer.
    r"\bin the background\b|\bwill (?:arrive|wake|notify|appear|follow|be delivered|report)\b|"
    r"\b(?:when|once|as soon as) (?:it|they|that|the \w+) (?:finish|complete|return|arrive|report)s?\b|"
    r"\b(?:report back|update you|let you know|get back to you|notify you)\b",
    re.IGNORECASE,
)

# Structure that means a deliverable was produced (lists, headings, code,
# tables, multiple paragraphs).
_STRUCTURE = re.compile(r"(?m)^\s*(?:[-*•]|\d+[.)]|#{1,6}\s|\||```)|\n\s*\n")


def narrated_intent_nudge_enabled() -> bool:
    env = os.environ.get("HERMES_INTENT_STOP_NUDGE")
    if env is not None and env.strip().lower() in {"0", "false", "no", "off"}:
        return False
    return True


def max_narrated_intent_nudges() -> int:
    raw = os.environ.get("HERMES_INTENT_STOP_MAX_NUDGES")
    try:
        return max(0, int(raw)) if raw else _DEFAULT_MAX_ATTEMPTS
    except ValueError:
        return _DEFAULT_MAX_ATTEMPTS


def looks_like_narrated_intent(text: Optional[str]) -> bool:
    """True when *text* only announces upcoming work and contains no result."""
    if not text or not isinstance(text, str):
        return False
    stripped = text.strip()
    if not stripped:
        return False
    if _STRUCTURE.search(stripped):
        return False
    if len(stripped.split()) > _MAX_WORDS:
        return False
    if _LEGIT_STOP.search(stripped):
        return False
    return bool(_INTENT.search(stripped))


def build_narrated_intent_nudge(
    *,
    final_response: Optional[str],
    attempts: int = 0,
    max_attempts: Optional[int] = None,
) -> Optional[str]:
    """Return a synthetic follow-up when a turn would end on a narrated intent.

    Returns ``None`` when the guard should not fire (disabled, budget spent,
    or the reply is a real answer / question / refusal).
    """
    if not narrated_intent_nudge_enabled():
        return None
    limit = _DEFAULT_MAX_ATTEMPTS if max_attempts is None else max_attempts
    if attempts >= limit:
        return None
    if not looks_like_narrated_intent(final_response):
        return None
    if attempts == 0:
        return (
            "[System: Your last reply only announced what you were about to do; "
            "nothing was done yet, and the user sees only the finished result. "
            "Continue now: carry out the work you described, using your tools "
            "where needed, and reply with the completed deliverable itself. Do "
            "not restate the plan, do not describe next steps, and do not end "
            "the turn with a promise of future action.]"
        )
    return (
        "[System: You again ended with a statement of intent instead of the "
        "result. Produce the finished deliverable in this reply. If something "
        "genuinely prevents you from doing it, say exactly what is blocking you "
        "and what you need; otherwise deliver the result now.]"
    )


__all__ = [
    "build_narrated_intent_nudge",
    "looks_like_narrated_intent",
    "max_narrated_intent_nudges",
    "narrated_intent_nudge_enabled",
]
