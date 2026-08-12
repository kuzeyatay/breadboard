"""JSON bridge onto the vendored book-to-skill clone.

Breadboard does not reimplement the clone's document handling. This script is
the only thing that talks to it: it puts the clone's package on `sys.path`,
calls its real functions, and prints one JSON object on stdout so the Node side
never has to parse the clone's human-facing console output.

Two modes:

  segment   Reads `{"text": "..."}` on stdin and returns the chapter boundaries
            the clone detects, plus its token estimate. Uses only the clone's
            pure-Python detection (`_chapter_number`, `_structural_chapter_count`,
            `detect_structure`, `estimate_tokens`), so it needs no optional
            dependencies and runs on a bare interpreter.

  extract   Reads a document off disk through the clone's own parser stack
            (`extract_single_file`) and returns its text plus metadata. This is
            the path that reaches formats Breadboard's Node extractor cannot
            read (EPUB, RTF, MOBI/AZW), and it does need the clone's optional
            dependencies for those formats.

Chapter *offsets* are what Breadboard needs and what the clone does not expose:
`detect_structure` returns a count and a sample of headings, not positions. So
this bridge walks the text line by line with the clone's own per-line matcher
and records where each heading starts. The detection logic stays the clone's;
only the bookkeeping is ours.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def _clone_root() -> Path:
    """Locate the vendored clone.

    An explicit env var wins so a relocated checkout stays supported; otherwise
    walk up from this file to the repository root, where the clone sits beside
    `dashboard/`.
    """
    override = os.environ.get("BOOK_TO_SKILL_ROOT", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "book-to-skill"


def _load_clone():
    root = _clone_root()
    if not (root / "book_to_skill" / "utils.py").is_file():
        raise SystemExit(
            json.dumps(
                {
                    "ok": False,
                    "error": f"book-to-skill clone not found at {root}",
                    "code": "clone_missing",
                }
            )
        )
    sys.path.insert(0, str(root))
    from book_to_skill import utils  # noqa: E402  (path must be set first)

    return utils


def _heading_title(line: str) -> str:
    """The heading text as a human would read it, without markup."""
    text = line.strip()
    while text.startswith("#") or text.startswith("="):
        text = text[1:]
    return text.strip(" \t#=*_").strip()


def _segment(utils, text: str) -> dict:
    """Chapter boundaries, using the clone's own per-line chapter matcher.

    Three tiers, mirroring the clone's own precedence in `detect_structure`:
    numbered chapter headings first, structural (Markdown/AsciiDoc) headings
    when there are none, and fixed-size windows when the document has no
    detectable structure at all — a scanned PDF or a wall of prose still has to
    be splittable into loadable pieces.
    """
    lines = text.splitlines(keepends=True)
    offsets = []
    cursor = 0
    for line in lines:
        offsets.append(cursor)
        cursor += len(line)

    marks = []
    for index, line in enumerate(lines):
        number = utils._chapter_number(line)
        if number is not None:
            marks.append(
                {
                    "number": number,
                    "title": _heading_title(line),
                    "start": offsets[index],
                    "kind": "numbered",
                }
            )

    if not marks:
        # No "Chapter N" headings: fall back to structural headings. The clone
        # counts these with a private helper that does not report positions, so
        # match the same shapes here (ATX/AsciiDoc heading lines) and let the
        # count be cross-checked against the clone below.
        for index, line in enumerate(lines):
            stripped = line.strip()
            match = utils._ATX_HEADING.match(stripped)
            if match and len(match.group(1)) <= 2:
                marks.append(
                    {
                        "number": len(marks) + 1,
                        "title": _heading_title(stripped),
                        "start": offsets[index],
                        "kind": "structural",
                    }
                )

    # Deduplicate: a table of contents repeats every chapter heading before the
    # body does, and an index may repeat them again after it. Keeping all of
    # them would split the book at its ToC and hand "Chapter 1" nothing but the
    # ToC line for chapter 2.
    #
    # Position is the wrong signal for this (a ToC is not always in the first N
    # characters, and an index is at the end), so choose by how much text each
    # occurrence actually owns: the distance to the next heading of a different
    # number. A ToC entry owns one line; the real chapter heading owns the
    # chapter.
    if marks:
        marks.sort(key=lambda mark: mark["start"])
        for index, mark in enumerate(marks):
            following = next(
                (
                    other
                    for other in marks[index + 1 :]
                    if other["number"] != mark["number"]
                ),
                None,
            )
            mark["span"] = (following["start"] if following else len(text)) - mark["start"]
        widest: dict[int, dict] = {}
        for mark in marks:
            best = widest.get(mark["number"])
            if best is None or mark["span"] > best["span"]:
                widest[mark["number"]] = mark
        marks = sorted(widest.values(), key=lambda mark: mark["start"])
        for mark in marks:
            mark.pop("span", None)

    chapters = []
    if marks:
        # Anything before the first heading is front matter; keep it only when
        # it is substantial enough to hold real content.
        if marks[0]["start"] > 2000:
            chapters.append(
                {
                    "number": 0,
                    "title": "Front matter",
                    "start": 0,
                    "end": marks[0]["start"],
                    "kind": "front-matter",
                }
            )
        for index, mark in enumerate(marks):
            end = marks[index + 1]["start"] if index + 1 < len(marks) else len(text)
            chapters.append(
                {
                    "number": mark["number"],
                    "title": mark["title"] or f"Section {mark['number']}",
                    "start": mark["start"],
                    "end": end,
                    "kind": mark["kind"],
                }
            )
    else:
        window = 24000
        index = 0
        while index * window < len(text) and index < 200:
            start = index * window
            chapters.append(
                {
                    "number": index + 1,
                    "title": f"Part {index + 1}",
                    "start": start,
                    "end": min(len(text), start + window),
                    "kind": "window",
                }
            )
            index += 1
        if not chapters:
            chapters.append(
                {"number": 1, "title": "Part 1", "start": 0, "end": len(text), "kind": "window"}
            )

    # Drop segments too small to be worth their own on-demand file by folding
    # them into the previous one, so a stray heading does not produce a chapter
    # containing one line.
    merged: list[dict] = []
    for chapter in chapters:
        if merged and (chapter["end"] - chapter["start"]) < 600:
            merged[-1]["end"] = chapter["end"]
            continue
        merged.append(chapter)

    structure = utils.detect_structure(text)
    return {
        "ok": True,
        "mode": "segment",
        "chapters": merged,
        "chaptersDetected": structure["chapters_detected"],
        "hasToc": structure["has_toc"],
        "headingSample": structure["chapter_headings_sample"],
        "estimatedTokens": utils.estimate_tokens(text),
    }


def _extract(utils, file_path: str, mode: str) -> dict:
    from book_to_skill.config import OUTPUT_DIR  # noqa: E402
    from book_to_skill.exceptions import ExtractionError  # noqa: E402

    try:
        result = utils.extract_single_file(Path(file_path), mode, "auto")
    except ExtractionError as error:
        return {"ok": False, "error": str(error), "code": "extraction_failed"}

    text = result.get("text", "") if isinstance(result, dict) else ""
    if not text:
        # Older/other return shapes write the text to the clone's workdir.
        candidate = OUTPUT_DIR / "full_text.txt"
        if candidate.is_file():
            text = candidate.read_text(encoding="utf-8", errors="replace")

    metadata = {
        key: value
        for key, value in (result.items() if isinstance(result, dict) else [])
        if key != "text"
    }
    return {"ok": True, "mode": "extract", "text": text, "metadata": metadata}


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--mode", required=True, choices=["segment", "extract"])
    parser.add_argument("--file")
    parser.add_argument("--extraction-mode", default="text", choices=["text", "technical"])
    args = parser.parse_args()

    utils = _load_clone()

    if args.mode == "segment":
        payload = json.loads(sys.stdin.read() or "{}")
        text = payload.get("text") or ""
        if not isinstance(text, str):
            print(json.dumps({"ok": False, "error": "text must be a string"}))
            return
        print(json.dumps(_segment(utils, text), ensure_ascii=False))
        return

    if not args.file:
        print(json.dumps({"ok": False, "error": "--file is required for extract"}))
        return
    print(json.dumps(_extract(utils, args.file, args.extraction_mode), ensure_ascii=False))


if __name__ == "__main__":
    main()
