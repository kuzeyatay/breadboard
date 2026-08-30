"""The keep/elide segment model shared by every compressor.

Every compressor works the same way: it takes a *source* text split into
lines and returns a list of segments saying which line ranges survive into
the model's context and which are elided. Elisions carry the original line
range, so recovering one is an exact slice of the cached source rather than
a re-run of the tool.

Keeping one model for all formats is what makes ranged retrieval uniform:
whatever the input was, ``expand_output(handle, offset, limit)`` is a line
window over the same cached source, and ``expand_output(handle, span=n)`` is
the range of the nth marker.

For JSON the source is the canonically pretty-printed form and for HTML it is
the extracted text, so line ranges stay meaningful in both. The header states
when the source was canonicalised.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Sequence


@dataclass(frozen=True)
class Keep:
    """Lines ``[start, end)`` reproduced verbatim."""

    start: int
    end: int


@dataclass(frozen=True)
class Elide:
    """Lines ``[start, end)`` replaced by a marker.

    ``note`` is a short human phrase describing what was dropped — "412
    similar log lines", "body of def parse()", "4,982 more items". It is the
    only thing the model sees about the elided region, so it should say
    enough to decide whether expanding is worth it.
    """

    start: int
    end: int
    note: str


Segment = Keep | Elide


def normalise(segments: Iterable[Segment], total_lines: int) -> List[Segment]:
    """Clamp, drop empties, sort, and merge adjacent same-kind segments.

    Compressors build segments locally and can emit overlapping or
    out-of-order ranges; this makes the result safe to render and to index.
    """
    cleaned: List[Segment] = []
    for seg in segments:
        start = max(0, min(seg.start, total_lines))
        end = max(0, min(seg.end, total_lines))
        if end <= start:
            continue
        if isinstance(seg, Keep):
            cleaned.append(Keep(start, end))
        else:
            cleaned.append(Elide(start, end, seg.note))

    # Earlier segments win: sorting by start and clipping each following
    # segment to the running cursor resolves every overlap the same way, with
    # no special cases between the two kinds.
    cleaned.sort(key=lambda s: (s.start, s.end))

    merged: List[Segment] = []
    cursor = 0
    for seg in cleaned:
        start = max(seg.start, cursor)
        if seg.end <= start:
            continue
        clipped: Segment = (
            Keep(start, seg.end)
            if isinstance(seg, Keep)
            else Elide(start, seg.end, seg.note)
        )
        cursor = clipped.end

        if merged:
            prev = merged[-1]
            if (
                isinstance(prev, Keep)
                and isinstance(clipped, Keep)
                and prev.end == clipped.start
            ):
                merged[-1] = Keep(prev.start, clipped.end)
                continue
        merged.append(clipped)

    return merged


def fill_gaps(segments: Sequence[Segment], total_lines: int) -> List[Segment]:
    """Cover every line: gaps between segments become Keep ranges.

    Compressors only have to declare what they *drop*; everything they stay
    silent about survives. That default — keep unless told otherwise — is the
    safe one for a lossy stage sitting in front of the model.
    """
    filled: List[Segment] = []
    cursor = 0
    for seg in segments:
        if seg.start > cursor:
            filled.append(Keep(cursor, seg.start))
        filled.append(seg)
        cursor = max(cursor, seg.end)
    if cursor < total_lines:
        filled.append(Keep(cursor, total_lines))
    return filled


def kept_chars(segments: Sequence[Segment], lines: Sequence[str]) -> int:
    """Character count of the Keep ranges, newlines included."""
    total = 0
    for seg in segments:
        if isinstance(seg, Keep):
            for idx in range(seg.start, seg.end):
                total += len(lines[idx]) + 1
    return total
