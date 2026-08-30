"""Line-oriented compressors: logs, code, diffs, search hits, plain text.

Each takes the source lines and returns the ranges it wants to *drop*.
Anything a compressor stays silent about survives — see
:func:`tools.tokenjuice.segments.fill_gaps`.

The shared bias: keep the parts a reader would look at first (errors, the
declarations, the changed lines, the head and tail) and elide the bulk that
repeats. Every drop is labelled well enough for the model to decide whether
recovering it is worth a tool call.
"""

from __future__ import annotations

import re
from typing import List, Sequence

from tools.tokenjuice.segments import Elide

# Always survive, wherever they are: the reason someone is reading the output.
_INTERESTING = re.compile(
    r"\b(error|errno|warn|warning|fail|failed|failure|exception|traceback|"
    r"fatal|panic|assert|denied|refused|timeout|timed out|unable to|cannot|"
    r"could not|not found|invalid|corrupt|abort)\b",
    re.IGNORECASE,
)

# Head and tail of any output are cheap and disproportionately informative:
# the command that ran, and how it ended.
_HEAD_LINES = 30
_TAIL_LINES = 30

# Runs shorter than this are not worth a marker — the marker itself would
# cost as much as the lines it replaces.
_MIN_RUN = 4


def _plural(count: int, noun: str) -> str:
    return f"{count:,} {noun}{'' if count == 1 else 's'}"


def _contiguous(indices: Sequence[int]) -> List[tuple[int, int]]:
    """Group a sorted index list into ``[start, end)`` runs of consecutive values."""
    runs: List[tuple[int, int]] = []
    for index in indices:
        if runs and runs[-1][1] == index:
            runs[-1] = (runs[-1][0], index + 1)
        else:
            runs.append((index, index + 1))
    return runs


# ─────────────────────────────────────────────────────────── logs ──


_NORMALISERS: Sequence[tuple[re.Pattern[str], str]] = (
    (re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?"), "<ts>"),
    (re.compile(r"\b\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\b"), "<ts>"),
    (re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"), "<uuid>"),
    (re.compile(r"\b0x[0-9a-fA-F]+\b"), "<hex>"),
    (re.compile(r"\b[0-9a-fA-F]{16,}\b"), "<hash>"),
    (re.compile(r"\b\d+(?:\.\d+)?(?:ms|s|us|ns|kb|mb|gb|%)\b", re.IGNORECASE), "<qty>"),
    (re.compile(r"\b\d+\b"), "<n>"),
)


def _normalise_log_line(line: str) -> str:
    """Collapse a log line to its shape, so repeats can be counted."""
    shape = line
    for pattern, placeholder in _NORMALISERS:
        shape = pattern.sub(placeholder, shape)
    return shape.strip()


def compress_logs(lines: Sequence[str]) -> List[Elide]:
    """Collapse runs of lines that differ only in their timestamps and numbers.

    Log volume is mostly one line repeated with a moving clock. Normalising
    away the moving parts turns that into a run, and a run of 400 identical
    shapes tells the reader as much in two lines plus a count as in 400.
    """
    total = len(lines)
    shapes = [_normalise_log_line(line) for line in lines]
    interesting = [bool(_INTERESTING.search(line)) for line in lines]

    drops: List[Elide] = []
    run_start = 0
    for idx in range(1, total + 1):
        same = idx < total and shapes[idx] == shapes[run_start] and shapes[idx] != ""
        if same:
            continue
        run_len = idx - run_start
        if run_len >= _MIN_RUN:
            # Keep the first and last of the run so the moving values are
            # still visible at both ends of the collapsed window.
            inner_start = run_start + 1
            inner_end = idx - 1
            droppable = [
                i
                for i in range(inner_start, inner_end)
                if not interesting[i] and _HEAD_LINES <= i < total - _TAIL_LINES
            ]
            # An error line or the head/tail guard can split the run, so drop
            # each contiguous stretch separately rather than one span across
            # the lines that earned their place.
            for chunk_start, chunk_end in _contiguous(droppable):
                if chunk_end - chunk_start >= _MIN_RUN - 2:
                    drops.append(
                        Elide(
                            chunk_start,
                            chunk_end,
                            f"{_plural(chunk_end - chunk_start, 'more line')} of the same shape",
                        )
                    )
        run_start = idx

    return drops


# ─────────────────────────────────────────────────────────── code ──


_DECL = re.compile(
    r"^\s*("
    r"(async\s+)?def\s+|class\s+|(export\s+)?(default\s+)?(async\s+)?function\s+"
    r"|(pub\s+)?(async\s+)?fn\s+|(interface|struct|impl|trait|enum|type)\s+"
    r"|(public|private|protected|internal|static|final|override)\b"
    r"|@\w+"
    r")"
)
_IMPORT = re.compile(r"^\s*(import|from|use|require|#include|package|using)\b")
_COMMENT = re.compile(r"^\s*(#|//|/\*|\*|--|\"\"\"|''')")

# Keep enough of a body to see what it opens with — the docstring, the guard
# clause, the first call — which is usually what the reader wanted.
_BODY_HEAD = 3
_MIN_BODY = 10


def _indent_of(line: str) -> int:
    return len(line) - len(line.lstrip())


def compress_code(lines: Sequence[str]) -> List[Elide]:
    """Keep the skeleton — imports, declarations, comments — elide long bodies.

    A body is a maximal run of lines indented deeper than the declaration
    that opened it, which holds across every brace- and indent-structured
    language without a parser for any of them.
    """
    total = len(lines)
    drops: List[Elide] = []
    idx = 0
    while idx < total:
        line = lines[idx]
        if not line.strip() or not _DECL.match(line) or _IMPORT.match(line):
            idx += 1
            continue

        decl_indent = _indent_of(line)
        body_start = idx + 1
        cursor = body_start
        while cursor < total:
            candidate = lines[cursor]
            if not candidate.strip():
                cursor += 1
                continue
            if _indent_of(candidate) <= decl_indent:
                break
            cursor += 1
        body_end = cursor

        # A class body is a list of declarations, not a body — eliding it
        # whole would replace every method signature in the file with one
        # "543 lines of class Foo" marker, which is the opposite of a
        # skeleton. Descend into it instead and let each method be judged.
        nested = any(
            _DECL.match(lines[i]) and _indent_of(lines[i]) > decl_indent
            for i in range(body_start, body_end)
        )
        if nested:
            idx = body_start
            continue

        if body_end - body_start >= _MIN_BODY:
            drop_start = body_start + _BODY_HEAD
            # Never drop the interesting lines out of a body — a raise or a
            # TODO inside a 200-line function is exactly the needle.
            while drop_start < body_end and _INTERESTING.search(lines[drop_start]):
                drop_start += 1
            if body_end - drop_start >= _MIN_RUN:
                name = line.strip()
                if len(name) > 60:
                    name = name[:57] + "..."
                drops.append(
                    Elide(
                        drop_start,
                        body_end,
                        f"{_plural(body_end - drop_start, 'line')} of `{name}`",
                    )
                )
        idx = max(body_end, idx + 1)

    return drops


# ─────────────────────────────────────────────────────────── diff ──


_DIFF_KEEP = re.compile(r"^(diff --git |index |--- |\+\+\+ |@@ |new file|deleted file|similarity|rename |Binary files)")
_DIFF_CONTEXT_KEEP = 2


def compress_diff(lines: Sequence[str]) -> List[Elide]:
    """Keep every changed line and every header; thin out long context runs.

    Unified diffs pad each hunk with unchanged context. Three lines of it
    orient the reader; sixty do not.
    """
    total = len(lines)
    drops: List[Elide] = []
    run_start: int | None = None

    def close(run_end: int) -> None:
        if run_start is None:
            return
        length = run_end - run_start
        if length < _DIFF_CONTEXT_KEEP * 2 + _MIN_RUN:
            return
        drops.append(
            Elide(
                run_start + _DIFF_CONTEXT_KEEP,
                run_end - _DIFF_CONTEXT_KEEP,
                f"{_plural(length - _DIFF_CONTEXT_KEEP * 2, 'unchanged line')}",
            )
        )

    for idx in range(total):
        line = lines[idx]
        is_context = line.startswith(" ") or (not line.strip())
        if is_context and not _DIFF_KEEP.match(line):
            if run_start is None:
                run_start = idx
        else:
            close(idx)
            run_start = None
    close(total)

    return drops


# ────────────────────────────────────────────────────────── search ──


_RESULT_BOUNDARY = re.compile(r"^\s*(\[?\d{1,3}[.)\]]\s+\S|#{1,4}\s+\S|Title:\s*\S)", re.IGNORECASE)
_SNIPPET_KEEP = 4
_MAX_RESULTS = 25


def compress_search(lines: Sequence[str]) -> List[Elide]:
    """Keep each result's head; trim its snippet, and cap the result count.

    Search output is a list whose value is front-loaded twice over: the first
    lines of each result carry the title and link, and the first results carry
    the relevance. Both tails compress hard.
    """
    total = len(lines)
    boundaries = [i for i, line in enumerate(lines) if _RESULT_BOUNDARY.match(line)]
    if len(boundaries) < 3:
        return []

    drops: List[Elide] = []
    bounded = boundaries + [total]
    for order, start in enumerate(boundaries):
        end = bounded[order + 1]
        if order >= _MAX_RESULTS:
            drops.append(
                Elide(
                    boundaries[_MAX_RESULTS],
                    total,
                    f"{_plural(len(boundaries) - _MAX_RESULTS, 'further result')}",
                )
            )
            break
        if end - start > _SNIPPET_KEEP + _MIN_RUN:
            drops.append(
                Elide(
                    start + _SNIPPET_KEEP,
                    end,
                    f"{_plural(end - start - _SNIPPET_KEEP, 'line')} of this result",
                )
            )

    return drops


# ──────────────────────────────────────────────────────────── text ──


def compress_text(lines: Sequence[str]) -> List[Elide]:
    """The safe fallback: collapse blank runs and consecutive duplicates.

    It assumes nothing about the content, so it only drops what is provably
    redundant. Anything still over budget after this is handled by the final
    squeeze in the engine, which is explicit about being a blunt cut.
    """
    total = len(lines)
    drops: List[Elide] = []

    run_start = 0
    for idx in range(1, total + 1):
        prev = lines[run_start]
        same = idx < total and (
            lines[idx] == prev or (not lines[idx].strip() and not prev.strip())
        )
        if same:
            continue
        run_len = idx - run_start
        if run_len >= _MIN_RUN:
            label = (
                f"{_plural(run_len - 1, 'blank line')}"
                if not prev.strip()
                else f"{_plural(run_len - 1, 'repeat')} of the line above"
            )
            drops.append(Elide(run_start + 1, idx, label))
        run_start = idx

    return drops
