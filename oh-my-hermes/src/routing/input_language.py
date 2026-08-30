"""Explicit input-script detection for the router contract.

OMH targets a global audience with English as the primary language. Its trigger
tables, however, only ever grew in two scripts: of 2315 catalog triggers, 1543
are Latin and 764 are Hangul, against 5 Han, 1 Kana, and zero Devanagari,
Arabic, or Cyrillic entries. `routing/localization.py` meanwhile renders chat
copy in ko/ja/zh/hi, so OMH answers in four non-English languages while the
router can only recognise two.

That gap was implicit: a Japanese or Hindi request simply scored zero and fell
through to a picker or fallback, and nothing in the contract said why. This
module makes it explicit. Detection here classifies the script of an incoming
message and states whether the deterministic trigger tables can be expected to
resolve it at all.

The policy this encodes: per-language trigger tables do not scale to a global
product. Adding another 764 entries per language is unbounded work that decays
as the catalog grows. Non-English intent resolution belongs to model selection
-- Hermes already understands every language OMH would target -- with OMH
supplying candidates and reasons rather than guessing from a token table. OMH
itself still makes no LLM call, so `docs/DIRECTION.md`'s "not an LLM router"
boundary holds.
"""

from __future__ import annotations

from functools import lru_cache


INPUT_LANGUAGE_SCHEMA_VERSION = "routing_input_language/v1"

SCRIPT_LATIN = "latin"
SCRIPT_HANGUL = "hangul"
SCRIPT_KANA = "kana"
SCRIPT_HAN = "han"
SCRIPT_DEVANAGARI = "devanagari"
SCRIPT_ARABIC = "arabic"
SCRIPT_CYRILLIC = "cyrillic"
SCRIPT_UNKNOWN = "unknown"

# Scripts the deterministic trigger tables actually carry entries for. Keep this
# tuple in sync with reality rather than with intent: a script belongs here only
# when the catalog has enough triggers in it to resolve ordinary requests, which
# `tests/test_routing_language_policy.py` re-derives from the catalog.
TRIGGER_BACKED_SCRIPTS: tuple[str, ...] = (SCRIPT_LATIN, SCRIPT_HANGUL)

SUPPORT_TRIGGER_BACKED = "trigger_backed"
SUPPORT_MODEL_SELECTION_REQUIRED = "model_selection_required"

_SCRIPT_RANGES: tuple[tuple[int, int, str], ...] = (
    (0x1100, 0x11FF, SCRIPT_HANGUL),
    (0x3040, 0x30FF, SCRIPT_KANA),
    (0x3130, 0x318F, SCRIPT_HANGUL),
    (0x4E00, 0x9FFF, SCRIPT_HAN),
    (0xAC00, 0xD7AF, SCRIPT_HANGUL),
    (0x0400, 0x04FF, SCRIPT_CYRILLIC),
    (0x0600, 0x06FF, SCRIPT_ARABIC),
    (0x0900, 0x097F, SCRIPT_DEVANAGARI),
)


def script_of_character(character: str) -> str:
    """Classify one character, or `unknown` for digits, punctuation, and symbols."""
    if not character:
        return SCRIPT_UNKNOWN
    if character.isascii():
        return SCRIPT_LATIN if character.isalpha() else SCRIPT_UNKNOWN
    codepoint = ord(character)
    for start, end, script in _SCRIPT_RANGES:
        if start <= codepoint <= end:
            return script
    return SCRIPT_UNKNOWN


@lru_cache(maxsize=8192)
def detect_input_script(message: str) -> str:
    """Return the dominant script of `message`.

    Latin only wins when no other script is present, because product names,
    command tokens, and code identifiers stay Latin inside otherwise non-Latin
    sentences: "Claude Code로 바로 열어줘" is a Korean request, not a Latin one.
    """
    counts: dict[str, int] = {}
    for character in message:
        script = script_of_character(character)
        if script == SCRIPT_UNKNOWN:
            continue
        counts[script] = counts.get(script, 0) + 1
    if not counts:
        return SCRIPT_UNKNOWN
    non_latin = {script: count for script, count in counts.items() if script != SCRIPT_LATIN}
    if non_latin:
        return max(non_latin.items(), key=lambda item: (item[1], item[0]))[0]
    return SCRIPT_LATIN


def routing_language_support(script: str) -> str:
    """State whether trigger tables can be expected to resolve this script."""
    return SUPPORT_TRIGGER_BACKED if script in TRIGGER_BACKED_SCRIPTS else SUPPORT_MODEL_SELECTION_REQUIRED


def routing_input_language(message: str) -> dict[str, object]:
    """Describe the input language as an explicit routing input."""
    script = detect_input_script(message)
    support = routing_language_support(script)
    return {
        "schema_version": INPUT_LANGUAGE_SCHEMA_VERSION,
        "script": script,
        "trigger_support": support,
        "boundary": (
            "Trigger tables carry Latin and Hangul entries only. A script marked "
            "model_selection_required is not unsupported; it means a deterministic "
            "trigger score is not evidence of intent and the decision belongs to "
            "model selection over supplied candidates."
        ),
    }
