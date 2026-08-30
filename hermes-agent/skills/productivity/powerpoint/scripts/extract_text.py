"""Extract ordered slide text and speaker notes from a PPTX/POTX package.

This is a local, bounded alternative to a hosted document converter. It reads
OOXML in memory, rejects oversized packages, and never extracts archive paths.
"""

from __future__ import annotations

import argparse
import posixpath
import sys
import zipfile
from pathlib import Path, PurePosixPath

from defusedxml import ElementTree as ET


MAX_ENTRIES = 10_000
MAX_MEMBER_BYTES = 25 * 1024 * 1024
MAX_TOTAL_BYTES = 250 * 1024 * 1024

P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def _checked_members(package: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    infos = package.infolist()
    if len(infos) > MAX_ENTRIES:
        raise ValueError(f"package has too many entries ({len(infos)} > {MAX_ENTRIES})")
    total = 0
    result: dict[str, zipfile.ZipInfo] = {}
    for info in infos:
        total += info.file_size
        if info.file_size > MAX_MEMBER_BYTES:
            raise ValueError(f"package member is too large: {info.filename}")
        if total > MAX_TOTAL_BYTES:
            raise ValueError("package expands beyond the safe size limit")
        normalized = info.filename.replace("\\", "/")
        if normalized.startswith("/") or ".." in PurePosixPath(normalized).parts:
            raise ValueError(f"unsafe package member path: {info.filename}")
        result[normalized] = info
    return result


def _read_xml(
    package: zipfile.ZipFile, members: dict[str, zipfile.ZipInfo], name: str
):
    info = members.get(name)
    if info is None:
        raise ValueError(f"required OOXML part is missing: {name}")
    return ET.fromstring(package.read(info))


def _relationships(root) -> dict[str, tuple[str, str]]:
    result: dict[str, tuple[str, str]] = {}
    for rel in root.findall(f"{{{PKG_REL_NS}}}Relationship"):
        rel_id = rel.get("Id")
        target = rel.get("Target")
        rel_type = rel.get("Type", "")
        if rel_id and target:
            result[rel_id] = (target, rel_type)
    return result


def _resolve_part(source_part: str, target: str) -> str:
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source_part), target))
    if resolved.startswith("../") or resolved.startswith("/"):
        raise ValueError(f"relationship escapes the OOXML package: {target}")
    return resolved


def _text_lines(root) -> list[str]:
    lines: list[str] = []
    for paragraph in root.iter(f"{{{A_NS}}}p"):
        text = "".join(
            node.text or "" for node in paragraph.iter(f"{{{A_NS}}}t")
        ).strip()
        if text:
            lines.append(text)
    return lines


def extract(path: Path) -> str:
    if path.suffix.lower() not in {".pptx", ".potx"}:
        raise ValueError("input must be a .pptx or .potx file")
    if not path.is_file():
        raise ValueError(f"file not found: {path}")

    with zipfile.ZipFile(path) as package:
        members = _checked_members(package)
        presentation_part = "ppt/presentation.xml"
        presentation = _read_xml(package, members, presentation_part)
        presentation_rels = _relationships(
            _read_xml(package, members, "ppt/_rels/presentation.xml.rels")
        )

        slide_parts: list[str] = []
        for slide_id in presentation.findall(f".//{{{P_NS}}}sldId"):
            rel_id = slide_id.get(f"{{{R_NS}}}id")
            relation = presentation_rels.get(rel_id or "")
            if relation:
                slide_parts.append(_resolve_part(presentation_part, relation[0]))

        output: list[str] = []
        for number, slide_part in enumerate(slide_parts, start=1):
            output.extend((f"<!-- Slide number: {number} -->", f"## Slide {number}"))
            output.extend(_text_lines(_read_xml(package, members, slide_part)) or ["(No text)"])

            rels_part = posixpath.join(
                posixpath.dirname(slide_part),
                "_rels",
                posixpath.basename(slide_part) + ".rels",
            )
            if rels_part in members:
                for target, rel_type in _relationships(
                    _read_xml(package, members, rels_part)
                ).values():
                    if rel_type.endswith("/notesSlide"):
                        notes_part = _resolve_part(slide_part, target)
                        notes = _text_lines(_read_xml(package, members, notes_part))
                        if notes:
                            output.extend(("", "### Speaker notes", *notes))
            output.append("")
        return "\n".join(output).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("presentation", type=Path)
    parser.add_argument("--output", type=Path, help="Write Markdown to this file.")
    args = parser.parse_args()
    try:
        content = extract(args.presentation)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(content, encoding="utf-8")
        else:
            sys.stdout.write(content)
        return 0
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
