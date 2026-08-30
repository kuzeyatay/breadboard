"""Two roots: what the agent may touch, and what belongs to the runtime.

File tools take absolute paths, which makes the boundary between "the work"
and "the machinery doing the work" a convention rather than a rule. Nothing
stops a model from reading ``$HERMES_HOME/auth.json``, writing over
``config.yaml``, or opening the session database — not because anyone decided
that was allowed, but because nobody wrote down that it was not.

So two roots are declared:

``workspace_root``  the runtime's own state: credentials, config, session and
                    memory databases, checkpoints. The agent has dedicated
                    tools for everything here that it legitimately needs; raw
                    file access to it is never the intended path, and it is
                    refused.

``action_root``     where the work happens. Declared always, enforced only when
                    the operator asks, because an existing install's agent
                    reads and writes across the whole machine by design and
                    silently confining it would break real workflows rather
                    than close a real hole.

The asymmetry is deliberate. Refusing the runtime's own state costs nothing
anyone wanted and removes a genuine footgun; confining the agent to one
project folder is a policy choice only the operator can make.

Configure in ``config.yaml``::

    paths:
      action_dir: ~/HermesProjects   # where work is allowed
      enforce_action_dir: true       # refuse paths outside it (default false)
      workspace_exceptions:          # relative paths inside HERMES_HOME to allow
        - skills/mine

This covers the file tools. A shell command run through the terminal tool can
still reach anything the user can — that is what a shell is — and this module
does not pretend otherwise.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

READ = "read"
WRITE = "write"

_cached: Optional[Dict[str, Any]] = None


def _config_section() -> Dict[str, Any]:
    try:
        from hermes_cli.config import load_config

        cfg = load_config() or {}
        section = cfg.get("paths") if isinstance(cfg, dict) else None
        return section if isinstance(section, dict) else {}
    except Exception:
        return {}


def _expand(value: Any) -> Optional[Path]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return Path(os.path.expandvars(value.strip())).expanduser().resolve()
    except (OSError, ValueError):
        return None


def _settings() -> Dict[str, Any]:
    global _cached
    if _cached is not None:
        return _cached

    section = _config_section()

    workspace: Optional[Path]
    try:
        from hermes_constants import get_hermes_home

        workspace = Path(get_hermes_home()).resolve()
    except Exception:
        workspace = None

    exceptions: List[Path] = []
    raw_exceptions = section.get("workspace_exceptions")
    if workspace is not None and isinstance(raw_exceptions, (list, tuple)):
        for entry in raw_exceptions:
            if not isinstance(entry, str) or not entry.strip():
                continue
            try:
                exceptions.append((workspace / entry.strip()).resolve())
            except (OSError, ValueError):
                continue

    action = _expand(os.environ.get("HERMES_ACTION_DIR")) or _expand(
        section.get("action_dir")
    )

    enforce = section.get("enforce_action_dir")
    if isinstance(enforce, str):
        enforce = enforce.strip().lower() in {"1", "true", "yes", "on"}

    _cached = {
        "workspace": workspace,
        "exceptions": exceptions,
        "action": action,
        # Enforcing without a root to enforce would refuse everything.
        "enforce_action": bool(enforce) and action is not None,
    }
    return _cached


def reset_cache() -> None:
    """Drop cached roots — for tests and config reload."""
    global _cached
    _cached = None


def workspace_root() -> Optional[Path]:
    """The runtime's own state directory, or None if it cannot be resolved."""
    return _settings()["workspace"]


def action_root() -> Optional[Path]:
    """Where work is meant to happen, or None when none is configured."""
    return _settings()["action"]


def action_root_enforced() -> bool:
    return bool(_settings()["enforce_action"])


def _within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _resolve(path_str: str) -> Optional[Path]:
    try:
        # `strict=False` so a path being created still resolves; symlinks in
        # the existing prefix are followed, which is the point — a symlink is
        # the obvious way around a root check.
        return Path(os.path.expandvars(str(path_str))).expanduser().resolve()
    except (OSError, ValueError, RuntimeError):
        return None


def check_path(path_str: str, operation: str = READ) -> Optional[str]:
    """Return a refusal message for *path_str*, or None when it is allowed.

    Never raises. A path this cannot make sense of is allowed through to the
    tool, which has its own error handling — failing open on an unparseable
    path is right here, because the alternative is refusing legitimate work on
    the basis of a bug in this function.
    """
    try:
        return _check(path_str, operation)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("Path root check failed for %r: %s", path_str, exc)
        return None


def _check(path_str: str, operation: str) -> Optional[str]:
    if not path_str or not str(path_str).strip():
        return None

    resolved = _resolve(path_str)
    if resolved is None:
        return None

    settings = _settings()
    workspace: Optional[Path] = settings["workspace"]

    if workspace is not None and _within(resolved, workspace):
        for allowed in settings["exceptions"]:
            if _within(resolved, allowed):
                return None
        verb = "write to" if operation == WRITE else "read"
        return (
            f"Refused: {resolved} is inside the runtime's own state directory "
            f"({workspace}), which holds credentials, configuration and the "
            f"session databases. Tools that need anything in there have their "
            f"own interface — memory, skills and config are all reachable "
            f"without raw file access. If you genuinely need to {verb} this "
            f"path, the operator can allow it under `paths.workspace_exceptions` "
            f"in config.yaml."
        )

    action: Optional[Path] = settings["action"]
    if settings["enforce_action"] and action is not None and not _within(resolved, action):
        return (
            f"Refused: {resolved} is outside the working root ({action}). "
            f"This install confines file operations to that folder "
            f"(`paths.enforce_action_dir`). Work inside it, or ask the operator "
            f"to widen `paths.action_dir`."
        )

    return None


def check_paths(paths: List[str], operation: str = READ) -> Optional[str]:
    """First refusal among several paths, or None when all are allowed."""
    for candidate in paths:
        refusal = check_path(candidate, operation)
        if refusal:
            return refusal
    return None


def describe_roots() -> Tuple[str, str]:
    """Human-readable (action, workspace) description, for prompts and status."""
    settings = _settings()
    action = settings["action"]
    workspace = settings["workspace"]
    action_text = (
        f"{action}{' (enforced)' if settings['enforce_action'] else ' (not enforced)'}"
        if action is not None
        else "anywhere the user can reach (no working root configured)"
    )
    workspace_text = str(workspace) if workspace is not None else "unknown"
    return action_text, workspace_text
