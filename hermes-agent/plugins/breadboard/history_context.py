"""Project canonical context onto the wire without duplicating exact history.

The dashboard retains the complete published context. Only this request's
projection changes, after Hermes has compressed/repaired its replay. Missing,
edited, ambiguous or out-of-order messages are kept. Neither the live transcript
nor the stored/system prompt is mutated, so a later compression restores any
copy no longer present in the outgoing history.
"""

from __future__ import annotations

from collections import Counter, defaultdict
import re
from typing import Any

START = "<!-- breadboard:recent-history:v1 -->\n"
END = "<!-- /breadboard:recent-history -->"
_HEADER = re.compile(rb"<!-- message (user|assistant) ([a-z_]+) ([0-9]{1,7}) -->\n")


def _text(content: Any) -> str | None:
    if isinstance(content, str):
        return content
    # Do not equate a multimodal message with its text-only rendering.
    if isinstance(content, list) and len(content) == 1:
        part = content[0]
        if isinstance(part, dict) and part.get("type") in {"text", "input_text", "output_text"}:
            value = part.get("text")
            return value if isinstance(value, str) else None
    return None


def _history(request: dict) -> dict[tuple[str, str], list[int]]:
    messages = request.get("messages", request.get("input"))
    if not isinstance(messages, list):
        return {}
    # A repeated current question or an in-progress draft is not proof that
    # the corresponding earlier exchange survived in the runtime history.
    cutoff = max((i for i, m in enumerate(messages)
                  if isinstance(m, dict) and m.get("role") == "user"), default=0)
    result = defaultdict(list)
    for i, message in enumerate(messages[:cutoff]):
        if not isinstance(message, dict) or message.get("role") not in {"user", "assistant"}:
            continue
        if message.get("tool_calls"):
            continue
        content = _text(message.get("content"))
        if content:
            result[(message["role"], content)].append(i)
    return result


def _parse(text: str) -> tuple[int, int, list[tuple[str, str, str]]] | None:
    if text.count(START) != 1 or text.count(END) != 1:
        return None
    start = text.index(START)
    end = text.index(END)
    if end < start:
        return None
    raw = text[start + len(START):end].encode("utf-8")
    messages = []
    cursor = 0
    while cursor < len(raw):
        match = _HEADER.match(raw, cursor)
        if match is None:
            return None
        role, surface = (value.decode("ascii") for value in match.groups()[:2])
        length = int(match.group(3))
        cursor = match.end()
        body = raw[cursor:cursor + length]
        if len(body) != length or raw[cursor + length:cursor + length + 1] != b"\n":
            return None
        try:
            line = body.decode("utf-8")
        except UnicodeDecodeError:
            return None
        prefix = f"{role.upper()} [{surface}]: "
        if not line.startswith(prefix):
            return None
        messages.append((role, prefix, line[len(prefix):]))
        cursor += length + 1
    if not messages:
        return None
    return start, end + len(END), messages


def _project(text: str, history: dict) -> tuple[str, int]:
    parsed = _parse(text)
    if parsed is None:
        return text, 0
    start, end, messages = parsed
    occurrences = Counter((role, content) for role, _, content in messages)
    matched = {}
    for i, (role, prefix, content) in enumerate(messages):
        positions = history.get((role, content), [])
        if len(positions) == 1 and occurrences[(role, content)] == 1:
            matched[i] = positions[0]
    # Different ordering can indicate a branch or a replay repair. Keep the
    # authoritative context instead of guessing which occurrence it describes.
    positions = list(matched.values())
    if any(a >= b for a, b in zip(positions, positions[1:])):
        matched = {}
    lines = []
    removed = 0
    for i, (role, prefix, content) in enumerate(messages):
        reference = f"[Published text is identical to the earlier {role} message in conversation history.]"
        if i in matched and len(content) > len(reference):
            lines.append(prefix + reference)
            removed += 1
        else:
            lines.append(prefix + content)
    return text[:start] + "\n".join(lines) + text[end:], removed


def deduplicate_history(request: dict[str, Any], **_context: Any) -> dict[str, Any] | None:
    """Hermes llm_request middleware; no model calls, state or schema changes."""
    history = _history(request)
    removed = 0
    changed = False

    def project_content(content: Any) -> Any:
        nonlocal removed, changed
        if isinstance(content, str):
            projected, count = _project(content, history)
            removed += count
            changed |= projected != content
            return projected
        if isinstance(content, list):
            return [{**part, "text": project_content(part["text"])}
                    if isinstance(part, dict) and part.get("type") in {"text", "input_text"}
                    and isinstance(part.get("text"), str) else part for part in content]
        return content

    projected = dict(request)
    for key in ("messages", "input"):
        messages = request.get(key)
        if isinstance(messages, list):
            projected[key] = [
                {**message, "content": project_content(message.get("content"))}
                if isinstance(message, dict) and message.get("role") in {"system", "developer"}
                else message for message in messages
            ]
    for key in ("system", "instructions"):
        if key in request:
            projected[key] = project_content(request[key])
    if not changed:
        return None
    return {"request": projected, "source": "breadboard-history",
            "reason": f"Preserved published context; {removed} exact history copies omitted."}
