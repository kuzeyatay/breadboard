"""Ranged retrieval — the half that makes the compression safe to do.

A lossy stage in front of the model is only acceptable if the loss is
reversible. Every elision the engine writes names a handle and a span, and
every one of them resolves here to the exact lines that were dropped.

Two addressing modes, both over the same cached source:

``span=N``               the Nth marker in that output
``offset=L, limit=C``    any window, whether it was elided or not

The second mode matters as much as the first: it lets the model page through
output it never saw compressed, which the old preview-plus-file-path could
only do when the sandbox spill happened to succeed.
"""

from __future__ import annotations

from typing import Optional

from tools.tokenjuice import cache

# One expansion should never itself blow the context it was called from.
MAX_EXPANSION_CHARS = 60_000
DEFAULT_LIMIT = 400


def _clip(text: str, limit: int = MAX_EXPANSION_CHARS) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    cut = text[:limit]
    last_newline = cut.rfind("\n")
    if last_newline > limit // 2:
        cut = cut[:last_newline]
    return cut, True


def expand(
    handle: str,
    *,
    span: Optional[int] = None,
    offset: Optional[int] = None,
    limit: Optional[int] = None,
) -> str:
    """Return the requested region of a compressed output, as text.

    Errors are returned as prose rather than raised: the caller is a tool
    handler whose output goes straight to the model, and a model that asked
    for span 9 of a 4-span output needs to be told that, not handed a stack
    trace.
    """
    resolved, candidates = cache.resolve(handle)
    if resolved is None:
        if candidates:
            joined = ", ".join(candidates[:8])
            return (
                f"The handle '{handle}' is ambiguous — it matches {len(candidates)} "
                f"cached outputs ({joined}). Use the full handle from the <juiced> header."
            )
        return (
            f"No cached output for handle '{handle}'. Handles come from the "
            "<juiced ... handle=\"...\"> header on a compressed tool result, and "
            "expire once the cache rolls over. Re-run the tool to get a fresh one."
        )

    entry = cache.load(resolved)
    source = cache.load_source(resolved)
    if entry is None or source is None:
        return f"The cached output for handle '{resolved}' is no longer readable."

    cache.touch(resolved)
    lines = source.split("\n")

    if span is not None:
        matched = next((item for item in entry.spans if item.get("index") == span), None)
        if matched is None:
            available = ", ".join(str(item.get("index")) for item in entry.spans) or "none"
            return (
                f"Output {resolved} has no span {span}. Available spans: {available}. "
                "You can still read any line window with offset and limit."
            )
        start = int(matched.get("start", 0))
        end = int(matched.get("end", start))
        body, clipped = _clip("\n".join(lines[start:end]))
        note = matched.get("note", "")
        header = (
            f"<expanded handle=\"{resolved}\" span=\"{span}\" "
            f"lines=\"{start + 1}-{end}\" of=\"{entry.source_lines:,}\">"
        )
        if note:
            header += f"\n({note})"
        if clipped:
            header += (
                f"\nThis span is larger than one expansion allows; showing the first "
                f"{len(body):,} characters. Continue with offset and limit."
            )
        return f"{header}\n{body}\n</expanded>"

    start = max(0, (offset or 1) - 1)
    count = limit if limit and limit > 0 else DEFAULT_LIMIT
    end = min(len(lines), start + count)
    if start >= len(lines):
        return (
            f"Output {resolved} has {entry.source_lines:,} lines; offset {offset} is past the end."
        )

    body, clipped = _clip("\n".join(lines[start:end]))
    header = (
        f"<expanded handle=\"{resolved}\" lines=\"{start + 1}-{end}\" "
        f"of=\"{entry.source_lines:,}\">"
    )
    if entry.source_note:
        header += f"\n(source is {entry.source_note})"
    if clipped:
        header += f"\nTruncated at {len(body):,} characters; continue from a later offset."
    elif end < len(lines):
        header += f"\n{len(lines) - end:,} further lines available from offset {end + 1}."
    return f"{header}\n{body}\n</expanded>"
