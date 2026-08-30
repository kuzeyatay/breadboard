"""Agency-agent persona resolution for delegated subagents.

When the orchestrator (Breadboard's "Chief of Staff") delegates via
``delegate_task`` it prefixes the task with ``[persona: <slug>]``. This module
turns that slug into an injectable specialist-identity block by reading the
matching markdown file from the agency-agents catalog.

Design notes:
- Root comes from ``AGENCY_AGENTS_PATH`` (the same directory Breadboard reads).
- Slugs mirror Breadboard's derivation (``dashboard/src/lib/hermes/
  agency-agents.ts``): the file stem, normalized, with the ``<division>-``
  prefix stripped. We index the stripped slug, the raw file-stem slug, and a
  division-qualified form so any reasonable reference resolves.
- Everything fails OPEN: any problem returns ``None`` and delegation proceeds
  with the plain goal, exactly as before this module existed.
"""

from __future__ import annotations

import os
import re
import threading
import unicodedata
from typing import Dict, Optional, Tuple

_LOCK = threading.Lock()
_index: Optional[Dict[str, str]] = None
_index_root: Optional[str] = None

_FRONTMATTER_RE = re.compile(r"^﻿?---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)
_NAME_RE = re.compile(r"^name:\s*(.+)$", re.MULTILINE)
_PERSONA_TAG_RE = re.compile(r"^\s*\[persona:\s*([a-z0-9][a-z0-9-]*)\]\s*", re.IGNORECASE)

_MAX_PERSONA_BODY_CHARS = 12_000


def persona_tag_pattern() -> "re.Pattern[str]":
    """Expose the tag matcher so callers strip it consistently."""
    return _PERSONA_TAG_RE


def _agency_root() -> Optional[str]:
    root = os.getenv("AGENCY_AGENTS_PATH")
    if root and os.path.isdir(root):
        return root
    return None


def _normalize_slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "").lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    normalized = re.sub(r"^-+|-+$", "", normalized)
    return normalized[:100]


def _build_index(root: str) -> Dict[str, str]:
    index: Dict[str, str] = {}
    try:
        entries = sorted(os.listdir(root))
    except OSError:
        return index
    for division in entries:
        division_dir = os.path.join(root, division)
        if not os.path.isdir(division_dir):
            continue
        division_slug = _normalize_slug(division)
        prefix = f"{division_slug}-"
        for dirpath, _dirs, files in os.walk(division_dir):
            for filename in sorted(files):
                if not filename.lower().endswith(".md"):
                    continue
                file_slug = _normalize_slug(filename[:-3])
                stripped = (
                    file_slug[len(prefix):]
                    if file_slug.startswith(prefix)
                    else file_slug
                )
                path = os.path.join(dirpath, filename)
                # First writer wins so the stripped slug (Breadboard's primary
                # form) is stable; alternate forms only fill gaps.
                for key in (stripped, file_slug, f"{stripped}-{division_slug}"):
                    if key and key not in index:
                        index[key] = path
    return index


def _get_index() -> Dict[str, str]:
    global _index, _index_root
    root = _agency_root()
    if not root:
        return {}
    with _LOCK:
        if _index is not None and _index_root == root:
            return _index
        _index = _build_index(root)
        _index_root = root
        return _index


def _parse_frontmatter_name(markdown: str) -> Tuple[Optional[str], str]:
    match = _FRONTMATTER_RE.match(markdown)
    if not match:
        return None, markdown.strip()
    frontmatter, body = match.group(1), match.group(2)
    name = None
    name_match = _NAME_RE.search(frontmatter)
    if name_match:
        name = name_match.group(1).strip().strip('"').strip("'")
    return name, body.strip()


def render_persona_block(slug: str) -> Optional[str]:
    """Return an injectable specialist-identity block for a roster slug, or None.

    Fails open: unknown slug / unset root / read error all return None.
    """
    normalized = _normalize_slug(slug)
    if not normalized:
        return None
    path = _get_index().get(normalized)
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            markdown = handle.read()
    except OSError:
        return None
    name, body = _parse_frontmatter_name(markdown)
    if not body:
        return None
    body = body[:_MAX_PERSONA_BODY_CHARS]
    header = (
        f"You are acting as **{name}**."
        if name
        else "You are acting as the requested specialist."
    )
    return (
        f"{header} Adopt this expert's identity, standards, and voice while you "
        "complete the task below.\n\n"
        f"--- SPECIALIST PERSONA ---\n{body}\n--- END PERSONA ---"
    )


def split_persona_tag(goal: str) -> Tuple[Optional[str], str]:
    """Split a leading ``[persona: slug]`` tag off a goal.

    Returns ``(slug_or_None, goal_without_tag)``.
    """
    if not goal:
        return None, goal
    match = _PERSONA_TAG_RE.match(goal)
    if not match:
        return None, goal
    return match.group(1), goal[match.end():]
