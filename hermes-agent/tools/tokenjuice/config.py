"""TokenJuice configuration.

Read from the ``tokenjuice`` section of ``config.yaml``, defensively: any
error (missing file, wrong types) falls back to the built-in defaults so a
malformed config can never break a tool call.

Example ``config.yaml``::

    tokenjuice:
      enabled: true
      min_chars: 4000          # never compress anything smaller
      cache_max_mb: 256        # disk cache ceiling
      cache_max_age_days: 14
      disabled_formats: [html] # opt out of individual compressors
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Set

DEFAULT_ENABLED = True
DEFAULT_MIN_CHARS = 4_000
DEFAULT_CACHE_MAX_MB = 256
DEFAULT_CACHE_MAX_AGE_DAYS = 14

# Beyond this the format detectors and compressors stop being cheap relative
# to the win, and a pathological input (a 200 MB log) should not stall a turn.
DEFAULT_MAX_INPUT_CHARS = 32_000_000


@dataclass(frozen=True)
class JuiceConfig:
    enabled: bool = DEFAULT_ENABLED
    min_chars: int = DEFAULT_MIN_CHARS
    cache_max_mb: int = DEFAULT_CACHE_MAX_MB
    cache_max_age_days: int = DEFAULT_CACHE_MAX_AGE_DAYS
    max_input_chars: int = DEFAULT_MAX_INPUT_CHARS
    disabled_formats: Set[str] = field(default_factory=frozenset)

    def format_enabled(self, fmt: str) -> bool:
        return fmt not in self.disabled_formats


_cached: JuiceConfig | None = None


def _positive_int(value: Any, default: int) -> int:
    try:
        iv = int(value)
    except (TypeError, ValueError):
        return default
    return iv if iv > 0 else default


def _bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    return default


def get_config() -> JuiceConfig:
    """Return the resolved TokenJuice config. Never raises; cached per process."""
    global _cached
    if _cached is not None:
        return _cached

    section: Dict[str, Any] = {}
    try:
        from hermes_cli.config import load_config

        cfg = load_config() or {}
        raw = cfg.get("tokenjuice") if isinstance(cfg, dict) else None
        if isinstance(raw, dict):
            section = raw
    except Exception:
        section = {}

    raw_disabled = section.get("disabled_formats")
    disabled: Set[str] = frozenset()
    if isinstance(raw_disabled, (list, tuple, set)):
        disabled = frozenset(
            str(item).strip().lower() for item in raw_disabled if str(item).strip()
        )

    _cached = JuiceConfig(
        enabled=_bool(section.get("enabled"), DEFAULT_ENABLED),
        min_chars=_positive_int(section.get("min_chars"), DEFAULT_MIN_CHARS),
        cache_max_mb=_positive_int(section.get("cache_max_mb"), DEFAULT_CACHE_MAX_MB),
        cache_max_age_days=_positive_int(
            section.get("cache_max_age_days"), DEFAULT_CACHE_MAX_AGE_DAYS
        ),
        max_input_chars=_positive_int(
            section.get("max_input_chars"), DEFAULT_MAX_INPUT_CHARS
        ),
        disabled_formats=disabled,
    )
    return _cached


def reset_config_cache() -> None:
    """Drop the cached config — for tests and config hot-reload."""
    global _cached
    _cached = None
