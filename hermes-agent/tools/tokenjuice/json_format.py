"""Structural compression for JSON tool output.

JSON is the format where blind truncation is worst: cutting a 400 KB API
response at 1,500 chars leaves the model an unparseable fragment of the first
object and nothing about the shape of the other four thousand. It is also the
format where structure buys the most — an array of homogeneous records is
fully described by a few examples plus a count.

The approach is two-pass. First the value is re-emitted as canonical
pretty-printed JSON by a writer that records the line span of every container
it writes. That canonical text becomes the *source*: the thing the cache
stores and the thing line offsets refer to, so recovering an elided span is
the same slice operation as for every other format. Second, the recorded
spans are walked and the ones worth dropping are turned into elisions.

The model therefore sees valid, indented JSON with holes in it, and each hole
says how many records it stands for.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, List, Tuple

from tools.tokenjuice.segments import Elide

# Show this many entries of a long array before eliding the rest. Two is
# enough to show the shape and that it repeats; the count carries the size.
_ARRAY_KEEP = 3
# Arrays shorter than this are cheaper to show whole than to describe.
_ARRAY_MIN = 6
# Objects with more keys than this get their tail elided — rare, but a single
# object keyed by ten thousand ids does happen.
_OBJECT_KEEP = 40
_OBJECT_MIN = 60

_INDENT = "  "


@dataclass
class _Container:
    """A container node and where it landed in the emitted text."""

    kind: str          # "array" | "object"
    entries: int       # element / key count
    first_entry: int   # line index of the first entry
    end: int           # line index one past the closing bracket
    entry_starts: List[int]
    depth: int


class _Emitter:
    """Pretty-print JSON while recording each container's line span.

    ``json.dumps(indent=2)`` produces the same text but tells you nothing
    about where anything landed, and re-deriving that by parsing the output
    costs more than emitting it.
    """

    def __init__(self) -> None:
        self.lines: List[str] = []
        self.containers: List[_Container] = []

    def emit(self, value: Any) -> str:
        self._write(value, depth=0, prefix="", suffix="")
        return "\n".join(self.lines)

    def _write(self, value: Any, depth: int, prefix: str, suffix: str) -> None:
        pad = _INDENT * depth
        if isinstance(value, dict) and value:
            self.lines.append(f"{pad}{prefix}{{")
            first_entry = len(self.lines)
            entry_starts: List[int] = []
            items = list(value.items())
            for position, (key, item) in enumerate(items):
                entry_starts.append(len(self.lines))
                tail = "," if position < len(items) - 1 else ""
                self._write(item, depth + 1, f"{json.dumps(str(key))}: ", tail)
            self.lines.append(f"{pad}}}{suffix}")
            self.containers.append(
                _Container("object", len(items), first_entry, len(self.lines), entry_starts, depth)
            )
        elif isinstance(value, list) and value:
            self.lines.append(f"{pad}{prefix}[")
            first_entry = len(self.lines)
            entry_starts = []
            for position, item in enumerate(value):
                entry_starts.append(len(self.lines))
                tail = "," if position < len(value) - 1 else ""
                self._write(item, depth + 1, "", tail)
            self.lines.append(f"{pad}]{suffix}")
            self.containers.append(
                _Container("array", len(value), first_entry, len(self.lines), entry_starts, depth)
            )
        else:
            self.lines.append(f"{pad}{prefix}{json.dumps(value, ensure_ascii=False)}{suffix}")


def _shape_of(value: Any) -> str:
    """A one-phrase description of what an elided array's entries look like."""
    if isinstance(value, dict):
        keys = list(value.keys())[:6]
        rendered = ", ".join(str(key) for key in keys)
        if len(value) > 6:
            rendered += ", …"
        return f"objects with keys ({rendered})" if rendered else "objects"
    if isinstance(value, list):
        return "arrays"
    if isinstance(value, bool):
        return "booleans"
    if isinstance(value, (int, float)):
        return "numbers"
    if isinstance(value, str):
        return "strings"
    return "values"


def _homogeneous(items: List[Any]) -> bool:
    """True when a sample of the list shares one type (and one key set, for dicts)."""
    sample = items[:50]
    if not sample:
        return False
    first = sample[0]
    if isinstance(first, dict):
        signature = tuple(sorted(first.keys()))
        return all(
            isinstance(item, dict) and tuple(sorted(item.keys())) == signature
            for item in sample
        )
    return all(type(item) is type(first) for item in sample)


def canonicalise(content: str) -> Tuple[str, List[Elide]] | None:
    """Return the canonical source text and the spans worth eliding.

    ``None`` means this is not JSON we can work with, and the caller should
    fall back to a line-based compressor.
    """
    try:
        value = json.loads(content)
    except (ValueError, RecursionError):
        return None

    if not isinstance(value, (dict, list)) or not value:
        return None

    emitter = _Emitter()
    try:
        source = emitter.emit(value)
    except RecursionError:
        return None

    # Deepest-first, so an elision inside a kept entry is recorded before the
    # broad one that might swallow it; segment normalisation keeps whichever
    # starts earlier, and the deep ones start later.
    ordered = sorted(emitter.containers, key=lambda node: (-node.depth, node.first_entry))

    drops: List[Elide] = []
    for node in ordered:
        if node.kind == "array" and node.entries >= _ARRAY_MIN:
            drop_from = node.entry_starts[_ARRAY_KEEP]
            remaining = node.entries - _ARRAY_KEEP
            drops.append(
                Elide(
                    drop_from,
                    node.end - 1,
                    f"{remaining:,} more entries of this array",
                )
            )
        elif node.kind == "object" and node.entries >= _OBJECT_MIN:
            drop_from = node.entry_starts[_OBJECT_KEEP]
            remaining = node.entries - _OBJECT_KEEP
            drops.append(
                Elide(drop_from, node.end - 1, f"{remaining:,} more keys of this object")
            )

    _label_array_shapes(value, drops)
    return source, drops


def _label_array_shapes(root: Any, drops: List[Elide]) -> None:
    """Upgrade array elision notes with the entry shape, where it is uniform.

    "4,982 more entries of this array" is useful; "4,982 more objects with
    keys (id, title, url, score)" tells the model whether it needs them.
    """
    shapes: List[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            if len(node) >= _ARRAY_MIN and _homogeneous(node):
                shapes.append(_shape_of(node[0]))
            else:
                shapes.append("")
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            for item in node.values():
                walk(item)

    try:
        walk(root)
    except RecursionError:
        return

    # walk() and the emitter visit containers in different orders, so this
    # only fires when there is exactly one qualifying array to describe —
    # the common case (one big result list) and the only one worth guessing at.
    described = [shape for shape in shapes if shape]
    array_drops = [drop for drop in drops if "entries of this array" in drop.note]
    if len(described) == 1 and len(array_drops) == 1:
        index = drops.index(array_drops[0])
        count = array_drops[0].note.split(" more", 1)[0]
        drops[index] = Elide(
            array_drops[0].start,
            array_drops[0].end,
            f"{count} more {described[0]}",
        )
