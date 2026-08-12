from __future__ import annotations

"""Unslop integration for the Breadboard Council.

Unslop (https://github.com/asavvin-pixel/unslop) is a Claude *skill* — a body of
writing rules that strip the signs of AI writing from English prose. It is not a
program; "using it" means feeding its rules into the prompt that writes the text
a person will read.

We attach those rules to exactly the two places the council produces the final,
user-facing answer (the compact/direct answer and the chair synthesis), and only
when that answer is natural-language prose shown in the UI: interactive chat
replies and generated learning-page prose. Structured/machine output (JSON maps,
visual specs, tags, OCR, critiques, evolution artifacts) is never humanized.
"""

import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Task types whose council output is natural-language prose shown to a person in
# the Breadboard UI: interactive chat answers (which carry no task_type, handled
# by unslop_applies) plus generated/edited learning-page prose. Everything else —
# JSON structures (source_map, learning_spine, scope_contract, topic_map),
# visual specs, tags/labels, OCR, critiques, evolution artifacts — must never be
# humanized, so those task types are deliberately absent here.
UNSLOP_PROSE_TASK_TYPES = frozenset(
    {
        "subsection_generation",
        "section_generation",
        "full_page_revision",
        "subsection_repair",
        "small_revision",
        "source_synthesis",
        "page_assistant_answer",
    }
)

_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw in _TRUE_VALUES:
        return True
    if raw in _FALSE_VALUES:
        return False
    return default


def unslop_enabled() -> bool:
    """Read at request time so operators and tests can flip it live."""
    return _env_bool("ENABLE_UNSLOP", True)


def unslop_applies(task_type: Optional[str]) -> bool:
    """True when the council's final answer is UI-facing prose that should be
    humanized. Interactive chat carries no task_type; learning-page prose carries
    one of the allowlisted task types. Structured/machine task types never match."""
    if not unslop_enabled():
        return False
    if task_type is None or not str(task_type).strip():
        return True
    return str(task_type).strip() in UNSLOP_PROSE_TASK_TYPES


# --- skill text loading --------------------------------------------------

# Guard wrapper placed above the loaded skill. It scopes the skill to prose and
# hard-protects the structured markup Breadboard pages depend on (math, formulas,
# breadboard-visual JSON blocks, source anchors, Q/A formatting), and it defers
# to any required output format so machine-readable answers are never touched.
_UNSLOP_HEADER = """=== UNSLOP: humanize this final, user-facing answer ===
The answer you are about to write will be shown directly to a person in the Breadboard UI. Apply the writing skill below so it does not read as machine-generated. Rewrite on top of these rules; never announce that you did, and never mention this skill.

These hard limits override anything in the skill:
- Rewrite natural-language prose ONLY. Never alter, reorder, translate, or reformat: fenced code blocks, inline or display math ($...$, $$...$$), LaTeX, formulas and their term definitions, ```breadboard-visual``` JSON blocks, tables, source-anchor ids such as S1.P12.F1, question/answer numbering, or YAML frontmatter. Humanize only the sentences around such elements.
- If the request demands a specific output format (JSON only, a fixed template, code only, a strict schema), ignore this entire skill and obey that format exactly.
- Never invent facts, numbers, examples, thresholds, citations, or specifics for "liveliness". Removing slop must not change the meaning or add any unsupported claim.
- Operate in careful mode: keep the request's language, its structure, and roughly its length (80-110%). A post stays a post; a learning section stays a learning section.

The skill follows.
"""

# Prepended above the calibrated author profile so the model treats it as an
# override of the skill's defaults, within the same hard limits.
_STYLE_PROFILE_HEADER = """The author has calibrated a personal voice profile below. It OVERRIDES this skill's stylistic defaults (typography, vocabulary, rhythm, personal tics, per-genre registers) — write as this author writes, keeping their pet words and quirks. The profile can NOT enable invented facts or switch off the "what human writing is allowed to do" / epistemics rules. If the profile is empty or absent, use the skill defaults.

--- AUTHOR VOICE PROFILE ---
"""

_UNSLOP_FOOTER = "\n=== end UNSLOP ===\n"

_cached_directive: Optional[str] = None
_cache_key: Optional[str] = None


def _candidate_skill_dirs() -> List[Path]:
    """Where the cloned unslop repo might live, most specific first."""
    dirs: List[Path] = []
    env_dir = os.environ.get("UNSLOP_SKILL_DIR")
    if env_dir and env_dir.strip():
        dirs.append(Path(env_dir.strip()))
    here = Path(__file__).resolve()
    # .../breadboard/chatmock/chatmock/council/unslop.py — walk up to the repo
    # root (breadboard/) and look for a sibling `unslop/` clone.
    for parent in list(here.parents)[:6]:
        dirs.append(parent / "unslop")
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        dirs.append(Path(meipass) / "unslop")
    dirs.append(Path.cwd() / "unslop")
    return dirs


def skill_dir() -> Optional[Path]:
    """First candidate directory that actually holds the unslop skill."""
    for base in _candidate_skill_dirs():
        try:
            if (base / "SKILL.md").is_file():
                return base
        except Exception:
            continue
    return None


def style_profile_path() -> Optional[Path]:
    """Where the calibrated author profile lives (may not exist yet)."""
    base = skill_dir()
    return (base / "references" / "style-profile.md") if base else None


def _directive_source_paths(base: Path) -> List[Path]:
    paths = [base / "SKILL.md"]
    if _env_bool("UNSLOP_INCLUDE_BLACKLIST", True):
        paths.append(base / "references" / "blacklist.md")
    paths.append(base / "references" / "style-profile.md")
    return paths


def _mtime_key(base: Path) -> str:
    parts = [os.environ.get("UNSLOP_SKILL_DIR", ""), str(base)]
    for path in _directive_source_paths(base):
        try:
            parts.append(f"{path.name}:{path.stat().st_mtime_ns}" if path.exists() else f"{path.name}:-")
        except Exception:
            parts.append(f"{path.name}:?")
    return "|".join(parts)


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip() if path.is_file() else ""
    except Exception:
        return ""


def unslop_directive() -> Optional[str]:
    """The guard + full unslop skill text + calibrated author profile (when one
    exists). Returns None when the unslop repo cannot be found, so callers no-op
    safely instead of failing a user's answer. The result is cached by file
    mtime, so calibrating a new profile takes effect on the next answer without a
    restart."""
    global _cached_directive, _cache_key
    base = skill_dir()
    if base is None:
        _cached_directive, _cache_key = None, None
        return None

    key = _mtime_key(base)
    if _cached_directive is not None and _cache_key == key:
        return _cached_directive

    skill = _read(base / "SKILL.md")
    if not skill:
        _cached_directive, _cache_key = None, key
        return None
    if _env_bool("UNSLOP_INCLUDE_BLACKLIST", True):
        blacklist = _read(base / "references" / "blacklist.md")
        if blacklist:
            skill = skill + "\n\n" + blacklist

    directive = _UNSLOP_HEADER + "\n" + skill
    profile = _read(base / "references" / "style-profile.md")
    if profile:
        directive += "\n\n" + _STYLE_PROFILE_HEADER + profile + "\n--- END AUTHOR VOICE PROFILE ---\n"
    directive += _UNSLOP_FOOTER

    _cached_directive, _cache_key = directive, key
    return _cached_directive


def maybe_unslop_system(system: str, task_type: Optional[str]) -> str:
    """Append the unslop directive to a final-answer system prompt when the task
    produces UI-facing prose and the skill is available; otherwise return `system`
    unchanged."""
    if not unslop_applies(task_type):
        return system
    directive = unslop_directive()
    if not directive:
        return system
    return system + "\n\n" + directive


# --- council-bypassed requests -------------------------------------------

# The council declines any request that carries tools, and Hermes sends its
# Breadboard toolset on every turn — so the Terminal, Garden Chat, and Quartz
# surfaces never reached the code above. Their answers are the most-read prose
# in the product, so the same skill is attached on the passthrough. The marker
# is Breadboard's own assistant identity: it keeps the skill on Breadboard's
# UI turns and off other ChatMock callers.
BREADBOARD_UI_SYSTEM_MARKER = "You are Bread, the Breadboard assistant."

_SYSTEM_ROLES = {"system", "developer"}


def _message_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "\n".join(parts)
    return ""


def _demands_structured_output(payload: Dict[str, Any]) -> bool:
    """A forced function call or a schema means the answer is machine-read."""
    if isinstance(payload.get("response_format"), dict):
        return True
    choice = payload.get("tool_choice")
    if isinstance(choice, dict):
        return True
    return isinstance(choice, str) and choice.strip().lower() == "required"


def unslop_passthrough_applies(
    text_with_system: str,
    payload: Dict[str, Any],
) -> bool:
    """True when a council-bypassed request is a Breadboard UI prose turn."""
    task_type = payload.get("taskType") or payload.get("task_type")
    if not unslop_applies(task_type if isinstance(task_type, str) else None):
        return False
    if _demands_structured_output(payload):
        return False
    return BREADBOARD_UI_SYSTEM_MARKER in text_with_system


def maybe_unslop_messages(
    messages: List[Dict[str, Any]],
    payload: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Return `messages` with the directive appended to the system message of a
    Breadboard UI turn, or the same list unchanged. Never mutates the input."""
    if not isinstance(messages, list) or not messages:
        return messages
    system_indexes = [
        index
        for index, message in enumerate(messages)
        if isinstance(message, dict) and message.get("role") in _SYSTEM_ROLES
    ]
    if not system_indexes:
        return messages
    joined = "\n".join(
        _message_text(messages[index].get("content")) for index in system_indexes
    )
    if not unslop_passthrough_applies(joined, payload):
        return messages
    directive = unslop_directive()
    if not directive:
        return messages

    target = system_indexes[-1]
    existing = messages[target]
    content = _message_text(existing.get("content"))
    if _UNSLOP_HEADER.splitlines()[0] in content:
        return messages
    updated = list(messages)
    updated[target] = {**existing, "content": content + "\n\n" + directive}
    return updated


def maybe_unslop_instructions(
    instructions: object,
    payload: Dict[str, Any],
) -> object:
    """Responses-API form of {@link maybe_unslop_messages}."""
    if not isinstance(instructions, str) or not instructions.strip():
        return instructions
    if not unslop_passthrough_applies(instructions, payload):
        return instructions
    directive = unslop_directive()
    if not directive:
        return instructions
    if _UNSLOP_HEADER.splitlines()[0] in instructions:
        return instructions
    return instructions + "\n\n" + directive
