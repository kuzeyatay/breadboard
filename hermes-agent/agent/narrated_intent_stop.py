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


# ── Hand-back stops ────────────────────────────────────────────────────
# The sibling failure: the model has terminal/computer/browser tools but ends
# the turn by claiming it cannot reach the machine ("I can't access Downloads
# or run the installer from this chat") or by handing the user a step and
# waiting ("Complete that form and tell me when..."). Live 2026-11-20, chat
# 1211. Codex's contract is "if you encounter blockers, attempt to resolve
# them yourself"; this enforces it once per turn, for every model.

HOST_TOOLS = frozenset({
    "terminal_execute_command", "computer_use", "browser_terminal",
    "breadboard_use", "terminal",
})

_HOST_REFUSAL = re.compile(
    r"\bi (?:can['’]?t|cannot|can not|am unable to|['’]m unable to|am not able to|"
    r"['’]m not able to|don['’]t have (?:the )?(?:access|ability|permission) to)\s+"
    r"(?:directly\s+)?(?:access|run|open|install|execute|launch|download|reach|browse|"
    r"read|control|click|fill|operate|use your|see your)\b|"
    r"\bi (?:don['’]t|do not) have (?:direct |any )?access to (?:your|the user['’]s|local) "
    r"(?:computer|machine|pc|file ?system|files|desktop|downloads|terminal|system|disk|drive)\b",
    re.IGNORECASE,
)

_USER_STEP = re.compile(
    r"(?:^|[.!:]\s+|\n\s*(?:[-*•]|\d+[.)])?\s*)(?:please\s+)?"
    r"(?:open|run|launch|install|download|complete|fill(?: in| out)?|double-click|"
    r"navigate|go to|click|start|execute|submit|sign up|register|approve|grant|allow|enable)\b",
    re.IGNORECASE,
)

_WAIT_FOR_USER = re.compile(
    r"\b(?:tell me|let me know|ping me|message me) (?:when|once|after)\b|"
    r"\bonce you(?:['’]ve| have)?\b|\bafter you(?:['’]ve| have)?\b|"
    r"\bso (?:that )?i can\b",
    re.IGNORECASE,
)

# A step that genuinely needs the human: their secrets, money, identity proof.
_REAL_BLOCKER = re.compile(
    r"\b(?:password|passcode|credentials?|2fa|two-factor|one-time code|otp|captcha|"
    r"payment|credit card|your signature|biometric|physical(?:ly)?|plug in|unplug)\b",
    re.IGNORECASE,
)

_DEFAULT_MAX_HANDBACK_ATTEMPTS = 1


def looks_like_handback(text: Optional[str]) -> bool:
    """True when *text* refuses host access or parks a doable step on the user."""
    if not text or not isinstance(text, str) or not text.strip():
        return False
    if _REAL_BLOCKER.search(text):
        return False
    if _HOST_REFUSAL.search(text):
        return True
    return bool(_USER_STEP.search(text) and _WAIT_FOR_USER.search(text))


def build_handback_nudge(
    *,
    final_response: Optional[str],
    tool_names=(),
    attempts: int = 0,
    max_attempts: int = _DEFAULT_MAX_HANDBACK_ATTEMPTS,
) -> Optional[str]:
    """Return a synthetic follow-up when a tool-equipped turn hands work back."""
    if not narrated_intent_nudge_enabled() or attempts >= max_attempts:
        return None
    if not HOST_TOOLS.intersection(tool_names or ()):
        return None
    if not looks_like_handback(final_response):
        return None
    return (
        "[System: Your last reply handed a step back to the user or said you "
        "cannot reach their computer, but this session has tools that operate "
        "it (terminal, browser, or computer control). Paths outside the "
        "approved folders are not refused: calling the tool raises a "
        "permission card, or is approved automatically in YOLO mode. Do the "
        "step yourself now, then verify the result and report it with what you "
        "ran and the files involved. Only if it truly needs the user (their "
        "password, payment, a CAPTCHA, a physical action) say exactly that one "
        "thing and do every other part yourself.]"
    )


__all__ = [
    "HOST_TOOLS",
    "build_handback_nudge",
    "looks_like_handback",
    "build_narrated_intent_nudge",
    "looks_like_narrated_intent",
    "max_narrated_intent_nudges",
    "narrated_intent_nudge_enabled",
]
