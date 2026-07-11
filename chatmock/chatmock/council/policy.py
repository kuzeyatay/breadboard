from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import List, Optional

from ..model_registry import DEFAULT_MODEL
from .types import COUNCIL_MODES, CouncilInput, message_text

FULL_COUNCIL_TASKS = frozenset(
    {
        "subsection_generation",
        "section_generation",
        "topic_map",
        "learning_spine",
        "source_synthesis",
        "source_map",
        "scope_contract",
        "exam_question_generation",
        "full_page_revision",
    }
)

LITE_COUNCIL_TASKS = frozenset(
    {
        "visualization_generation",
        "small_revision",
        "critique",
        "note_generation",
    }
)

DIRECT_COUNCIL_TASKS = frozenset(
    {
        "tagging",
        "classification",
        "metadata_generation",
        "knowledge_extraction",
    }
)

EVOLUTION_COUNCIL_TASKS = frozenset(
    {
        "prompt_improvement",
        "template_improvement",
        "policy_improvement",
        "artifact_evolution",
    }
)

DEFAULT_COUNCIL_MODELS = [
    DEFAULT_MODEL,
]
DEFAULT_CHAIRMAN_MODEL = DEFAULT_MODEL

_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw in _TRUE_VALUES:
        return True
    if raw in _FALSE_VALUES:
        return False
    return default


def _parse_models(raw: Optional[str]) -> Optional[List[str]]:
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip()
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                models = [str(m).strip() for m in parsed if str(m).strip()]
                return models or None
        except Exception:
            pass
    models = [piece.strip() for piece in text.split(",") if piece.strip()]
    return models or None


def council_enabled() -> bool:
    """Read at request time so tests and operators can flip it live."""
    return _env_bool("ENABLE_COUNCIL", True)


@dataclass
class CouncilConfig:
    council_models: List[str] = field(default_factory=lambda: list(DEFAULT_COUNCIL_MODELS))
    chairman_model: str = DEFAULT_CHAIRMAN_MODEL
    default_council_mode: str = "direct_council"
    # ChatGPT OAuth model used for direct_council parity with legacy ChatMock calls.
    upstream_fallback_model: str = DEFAULT_MODEL
    ledger_dir: Optional[str] = None
    # Heuristics for chooseCouncilMode
    short_prompt_chars: int = 1200
    large_context_chars: int = 24000
    # Caps
    max_candidates: int = 3
    max_critics: int = 5
    evolution_candidates: int = 2
    request_timeout_seconds: int = 600

    @classmethod
    def from_env(cls) -> "CouncilConfig":
        cfg = cls()
        models = _parse_models(os.environ.get("COUNCIL_MODELS"))
        if models:
            cfg.council_models = models
        chairman = (os.environ.get("CHAIRMAN_MODEL") or "").strip()
        if chairman:
            cfg.chairman_model = chairman
        default_mode = (os.environ.get("DEFAULT_COUNCIL_MODE") or "").strip()
        if default_mode in COUNCIL_MODES:
            cfg.default_council_mode = default_mode
        fallback = (os.environ.get("COUNCIL_UPSTREAM_FALLBACK_MODEL") or "").strip()
        if fallback:
            cfg.upstream_fallback_model = fallback
        cfg.ledger_dir = (os.environ.get("COUNCIL_LEDGER_DIR") or "").strip() or None
        return cfg


def _explicit_source_context_chars(council_input: CouncilInput) -> int:
    if council_input.source_context is None:
        return 0
    try:
        return len(json.dumps(council_input.source_context))
    except Exception:
        return len(str(council_input.source_context))


def _source_context_chars(council_input: CouncilInput) -> int:
    total = _explicit_source_context_chars(council_input)
    for msg in council_input.messages or []:
        if isinstance(msg, dict) and msg.get("role") in ("system", "developer"):
            total += len(message_text(msg.get("content")))
    return total


def choose_council_mode(council_input: CouncilInput, config: CouncilConfig) -> str:
    override = (council_input.council_mode_override or "").strip()
    if override in COUNCIL_MODES:
        return override

    task_type = (council_input.task_type or "").strip()
    if task_type in FULL_COUNCIL_TASKS:
        return "full_council"
    if task_type in EVOLUTION_COUNCIL_TASKS:
        return "evolution_council"
    if task_type in DIRECT_COUNCIL_TASKS:
        return "direct_council"
    if task_type == "page_assistant_answer":
        # Interactive path: never escalates to full_council automatically.
        if (
            _explicit_source_context_chars(council_input) > 0
            or len(council_input.user_prompt or "") >= config.short_prompt_chars
        ):
            return "lite_council"
        return "direct_council"
    if task_type == "ocr":
        return "lite_council" if _explicit_source_context_chars(council_input) > 0 else "direct_council"
    if task_type in LITE_COUNCIL_TASKS:
        if _source_context_chars(council_input) > config.large_context_chars:
            return "full_council"
        return "lite_council"

    # Untagged requests: keep the kernel invisible and cheap. Very short,
    # low-risk prompts always take the direct path; everything else follows
    # the configured default.
    if len(council_input.user_prompt or "") < config.short_prompt_chars:
        return "direct_council"
    return config.default_council_mode
