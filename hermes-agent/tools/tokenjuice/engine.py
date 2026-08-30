"""The compression stage itself: detect, compress, cache, render, report.

Sits between a tool returning and its result entering the model's context.
The contract is narrow on purpose — :func:`compress` either returns a result
that fits the caller's budget, or returns ``None`` and the caller keeps doing
exactly what it did before. Nothing downstream has to know this stage exists.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import List, Optional, Sequence

from tools.tokenjuice import cache, detect, savings
from tools.tokenjuice.config import get_config
from tools.tokenjuice.segments import Elide, Keep, Segment, fill_gaps, kept_chars, normalise

logger = logging.getLogger(__name__)

# Below this the marker costs more than the lines it replaces, so a span that
# small is left alone even when a compressor asked to drop it.
_MIN_ELISION_CHARS = 120

# The final squeeze keeps more of the head than the tail: output is usually
# ordered by relevance or by time, and both put the answer near the top.
_HEAD_SHARE = 0.6

# Longest single line reproduced in full. Past this the line is clipped with a
# note rather than dropped whole; the rest stays readable by offset.
_MAX_LINE_CHARS = 4_000



@dataclass(frozen=True)
class Compressed:
    """A compression that met its budget."""

    text: str
    handle: str
    fmt: str
    original_chars: int
    kept_chars: int
    source_chars: int
    source_lines: int
    elisions: int

    @property
    def saved_chars(self) -> int:
        return max(0, self.original_chars - self.kept_chars)

    @property
    def ratio(self) -> float:
        if self.original_chars <= 0:
            return 0.0
        return self.saved_chars / self.original_chars


def _marker(handle: str, index: int, note: str) -> str:
    return f"[[juice:{handle[:cache.MARKER_CHARS]}#{index} · {note}]]"


def _prepare_source(content: str, fmt: str) -> tuple[str, str, List[Elide]]:
    """Return (source, source_note, structural elisions) for a format.

    Two formats change what "the original" means: JSON is re-emitted in
    canonical form and HTML is reduced to text. Both are recorded in the note
    so the header can say it, rather than letting an expansion silently return
    something other than what the tool produced.
    """
    if fmt == detect.JSON:
        from tools.tokenjuice.json_format import canonicalise

        prepared = canonicalise(content)
        if prepared is not None:
            source, drops = prepared
            return source, "re-indented canonical JSON", drops
        return content, "", []

    if fmt == detect.HTML:
        from tools.tokenjuice.html_format import extract_text

        text, removed = extract_text(content)
        if text.strip() and removed > 0:
            return text, f"text extracted from HTML ({removed:,} chars of markup removed)", []
        return content, "", []

    return content, "", []


def _line_drops(fmt: str, lines: Sequence[str]) -> List[Elide]:
    from tools.tokenjuice import line_formats

    if fmt == detect.LOGS:
        return line_formats.compress_logs(lines)
    if fmt == detect.CODE:
        return line_formats.compress_code(lines)
    if fmt == detect.DIFF:
        return line_formats.compress_diff(lines)
    if fmt == detect.SEARCH:
        return line_formats.compress_search(lines)
    return line_formats.compress_text(lines)


def _squeeze(
    segments: Sequence[Segment], lines: Sequence[str], budget: int
) -> List[Segment]:
    """Blunt last resort: cut the middle out of what survived.

    The format pass is judgement; this is arithmetic. It runs only when
    judgement did not get under budget, and it says so in its marker so the
    model knows the drop was not selective.
    """
    if kept_chars(segments, lines) <= budget:
        return list(segments)

    kept_lines = [
        line
        for seg in segments
        if isinstance(seg, Keep)
        for line in range(seg.start, seg.end)
    ]
    if not kept_lines:
        return list(segments)

    head_budget = int(budget * _HEAD_SHARE)
    tail_budget = budget - head_budget

    head_end = kept_lines[0]
    spent = 0
    for line in kept_lines:
        cost = len(lines[line]) + 1
        if spent + cost > head_budget:
            break
        spent += cost
        head_end = line + 1

    # A first line that busts the whole head budget on its own is still worth
    # keeping — the renderer clips it and says how much it clipped, which
    # beats eliding it and showing nothing at all.
    if head_end <= kept_lines[0]:
        head_end = kept_lines[0] + 1

    tail_start = kept_lines[-1] + 1
    spent = 0
    for line in reversed(kept_lines):
        cost = len(lines[line]) + 1
        if spent + cost > tail_budget:
            break
        spent += cost
        tail_start = line

    if tail_start > kept_lines[-1] and kept_lines[-1] >= head_end:
        tail_start = kept_lines[-1]

    if tail_start <= head_end:
        # No room for a tail. Everything after the head still gets a marker —
        # a drop without one is the one thing this stage must never do, since
        # the model would have no way to know it happened.
        if not head_end:
            return list(segments)
        remainder: List[Segment] = [Keep(0, head_end)]
        if head_end < len(lines):
            remainder.append(
                Elide(
                    head_end,
                    len(lines),
                    f"{len(lines) - head_end:,} lines cut to fit the context budget",
                )
            )
        return normalise(remainder, len(lines))

    # Keep the structure outside the cut — including the format pass's own
    # markers, which explain their drops better than the blunt one does — and
    # replace only what falls between the two boundaries.
    def clip(seg: Segment, start: int, end: int) -> Segment:
        return (
            Keep(start, end) if isinstance(seg, Keep) else Elide(start, end, seg.note)
        )

    squeezed: List[Segment] = []
    for seg in segments:
        if seg.end <= head_end or seg.start >= tail_start:
            squeezed.append(seg)
            continue
        # A single segment can straddle both boundaries — an uncompressed
        # result is exactly one Keep over the whole file — so both ends have
        # to be tested, not just the first that matches.
        if seg.start < head_end:
            squeezed.append(clip(seg, seg.start, head_end))
        if seg.end > tail_start:
            squeezed.append(clip(seg, tail_start, seg.end))

    squeezed.append(
        Elide(
            head_end,
            tail_start,
            f"{tail_start - head_end:,} lines cut to fit the context budget — "
            "the middle, not a selection",
        )
    )
    return normalise(squeezed, len(lines))


def _render(
    segments: Sequence[Segment],
    lines: Sequence[str],
    handle: str,
    line_cap: int = _MAX_LINE_CHARS,
) -> tuple[str, List[dict]]:
    body: List[str] = []
    spans: List[dict] = []
    index = 0
    for seg in segments:
        if isinstance(seg, Keep):
            for line in lines[seg.start : seg.end]:
                # Everything above works in whole lines, which leaves one
                # shape unhandled: output that is a single enormous line —
                # a minified bundle, a base64 blob, an unwrapped stack of
                # JSON. Without a per-line cap the line-based squeeze can
                # only take it or drop it, and dropping it shows the model
                # nothing. The whole line stays reachable through an offset
                # read.
                if len(line) > line_cap:
                    body.append(
                        f"{line[:line_cap]}… [line continues for "
                        f"{len(line) - line_cap:,} more characters]"
                    )
                else:
                    body.append(line)
            continue
        index += 1
        spans.append(
            {"index": index, "start": seg.start, "end": seg.end, "note": seg.note}
        )
        body.append(_marker(handle, index, seg.note))
    return "\n".join(body), spans


def _header(
    tool_name: str,
    fmt: str,
    handle: str,
    original_chars: int,
    kept: int,
    source_lines: int,
    source_note: str,
    elisions: int,
) -> str:
    saved = max(0, original_chars - kept)
    percent = int(round(saved * 100 / original_chars)) if original_chars else 0
    parts = [
        f'<juiced tool="{tool_name}" format="{fmt}" handle="{handle}"',
        f'original="{original_chars:,} chars" shown="{kept:,} chars" saved="{percent}%"',
        f'source_lines="{source_lines:,}">',
    ]
    lines = [" ".join(parts)]
    if source_note:
        lines.append(f"Source for expansion is {source_note}.")
    if elisions:
        lines.append(
            f"{elisions} elided span{'' if elisions == 1 else 's'} below are marked "
            f"[[juice:{handle[:cache.MARKER_CHARS]}#N · what was dropped]]. Recover one with "
            f'expand_output(handle="{handle}", span=N), or read any line window with '
            f'expand_output(handle="{handle}", offset=<line>, limit=<count>). '
            "Nothing was lost — every elided line is still retrievable."
        )
    return "\n".join(lines)


def compress(
    content: str,
    tool_name: str,
    *,
    budget: int,
    model: Optional[str] = None,
    record_savings: bool = True,
) -> Optional[Compressed]:
    """Compress *content* to at most *budget* characters, or return ``None``.

    ``None`` means the caller should fall through to whatever it did before —
    the input was too small to bother with, compression is off, the format
    could not be improved on, or something went wrong. Every failure mode is
    the same failure mode from the caller's side, which is what keeps this
    safe to put in front of every tool result in the system.
    """
    try:
        return _compress(
            content, tool_name, budget=budget, model=model, record_savings=record_savings
        )
    except Exception as exc:
        logger.warning("TokenJuice compression failed for %s: %s", tool_name, exc)
        return None


def _compress(
    content: str,
    tool_name: str,
    *,
    budget: int,
    model: Optional[str],
    record_savings: bool,
) -> Optional[Compressed]:
    config = get_config()
    if not config.enabled:
        return None

    original_chars = len(content)
    if original_chars < max(config.min_chars, budget):
        return None
    if original_chars > config.max_input_chars:
        return None

    fmt = detect.detect_format(content, tool_name)
    if not config.format_enabled(fmt):
        fmt = detect.TEXT

    source, source_note, structural_drops = _prepare_source(content, fmt)
    handle = cache.compute_handle(source, fmt)

    cached = cache.load(handle)
    if cached is not None and cached.compressed_text and cached.compressed_chars <= budget:
        cache.touch(handle)
        if record_savings:
            savings.record(
                tool_name=tool_name,
                fmt=cached.fmt,
                original_chars=original_chars,
                kept_chars=cached.compressed_chars,
                handle=handle,
                model=model,
            )
        return Compressed(
            text=cached.compressed_text,
            handle=handle,
            fmt=cached.fmt,
            original_chars=original_chars,
            kept_chars=cached.compressed_chars,
            source_chars=cached.source_chars,
            source_lines=cached.source_lines,
            elisions=len(cached.spans),
        )

    lines = source.split("\n")
    total_lines = len(lines)

    # JSON earns its elisions structurally; falling through to the line
    # compressor there would only re-describe what the structure already said.
    drops = list(structural_drops)
    if not drops:
        drops = _line_drops(fmt, lines)

    # Drop the drops that aren't worth a marker.
    worthwhile = [
        drop
        for drop in drops
        if sum(len(lines[i]) + 1 for i in range(drop.start, min(drop.end, total_lines)))
        >= _MIN_ELISION_CHARS
    ]

    segments = fill_gaps(normalise(worthwhile, total_lines), total_lines)

    # The squeeze is budgeted in source characters, but the header and the
    # markers ride along too, and a skeleton of a large file can carry a lot
    # of markers. Rather than guess a fixed allowance, render and measure,
    # then re-squeeze against the actual overshoot. Two corrections converge
    # on anything realistic; a third failure means the caller's spill path is
    # the honest answer.
    working_budget = max(1_000, budget - 900)
    text = ""
    spans: List[dict] = []
    for _ in range(3):
        attempt = _squeeze(segments, lines, working_budget)
        body, spans = _render(attempt, lines, handle)
        header = _header(
            tool_name, fmt, handle, original_chars, len(body), total_lines,
            source_note, len(spans),
        )
        text = f"{header}\n{body}\n</juiced>"
        if len(text) <= budget:
            break
        overshoot = len(text) - budget
        working_budget = max(1_000, working_budget - overshoot - 200)
    else:
        return None

    if len(text) >= original_chars:
        return None

    entry = cache.CacheEntry(
        handle=handle,
        tool_name=tool_name,
        fmt=fmt,
        original_chars=original_chars,
        source_chars=len(source),
        source_lines=total_lines,
        compressed_chars=len(text),
        created_at=time.time(),
        source_note=source_note,
        spans=spans,
        compressed_text=text,
    )
    cache.store(entry, source)

    if record_savings:
        savings.record(
            tool_name=tool_name,
            fmt=fmt,
            original_chars=original_chars,
            kept_chars=len(text),
            handle=handle,
            model=model,
        )

    return Compressed(
        text=text,
        handle=handle,
        fmt=fmt,
        original_chars=original_chars,
        kept_chars=len(text),
        source_chars=len(source),
        source_lines=total_lines,
        elisions=len(spans),
    )
