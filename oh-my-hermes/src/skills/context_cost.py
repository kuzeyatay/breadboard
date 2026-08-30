"""Deterministic prompt-context accounting for the generated skill pack.

`omh docs skill-context-cost` renders this payload. It answers one question:
how many bytes of always-loaded `SKILL.md` body does an install carry, and how
much of that body is text repeated verbatim across skills rather than guidance
specific to one workflow?

Two cost classes are tracked separately because they load differently:

- ``skill_body``: `skills/<name>/SKILL.md`. Loaded whenever Hermes puts the
  skill in context, once per installed skill. This is the per-turn cost the
  installer's context-cost warning is about.
- ``reference``: `skills/<name>/references/*.md`. Progressive disclosure --
  loaded only when a skill or the router explicitly points at it. Moving an
  invariant section from a body into a reference removes it from every
  installed skill's always-loaded weight and keeps exactly one copy on disk.

Repetition is derived, never hand-classified: for each `##` heading, sections
whose body text is byte-identical across skills are duplicates, and
``duplicate_bytes`` is what an install pays for the second and later copies.
"""

from __future__ import annotations

from .catalog import omh_skill_display_name

from dataclasses import dataclass

from .catalog import CORE_PROFILE_SKILLS
from .packaging import builtin_skill_reference_templates, builtin_skill_templates
from .render import SkillReferenceTemplate as _SkillReferenceTemplate
from .render import SkillTemplate as _SkillTemplate

SKILL_CONTEXT_COST_SCHEMA_VERSION = "omh_skill_context_cost/v1"

# Deterministic, dependency-free token estimate. Four characters per token is
# the usual English-prose approximation; it is a comparison unit for before/after
# work in this repo, not a tokenizer result.
CHARS_PER_TOKEN_ESTIMATE = 4


@dataclass(frozen=True)
class SectionSlice:
    skill: str
    heading: str
    body: str


def _split_sections(content: str) -> list[tuple[str, str]]:
    """Split rendered markdown into `(heading, body)` pairs.

    The `## ` line stays at the head of its own body, and frontmatter plus any
    preamble before the first heading is returned under the synthetic heading
    ``"(preamble)"``. Both rules exist so the section bytes of a skill sum to
    exactly ``len(content)`` -- a repeated heading line is repeated cost too.
    """
    sections: list[tuple[str, str]] = []
    heading = "(preamble)"
    buffer: list[str] = []
    for line in content.splitlines(keepends=True):
        if line.startswith("## "):
            sections.append((heading, "".join(buffer)))
            heading = line[3:].strip()
            buffer = [line]
            continue
        buffer.append(line)
    sections.append((heading, "".join(buffer)))
    return sections


def _estimated_tokens(chars: int) -> int:
    return -(-chars // CHARS_PER_TOKEN_ESTIMATE)


def _size_payload(text_chars: int, line_count: int) -> dict[str, int]:
    return {
        "bytes": text_chars,
        "lines": line_count,
        "estimated_tokens": _estimated_tokens(text_chars),
    }


def _profile_skill_names(profile: str, templates: list[_SkillTemplate]) -> set[str]:
    names = {template.name for template in templates}
    if profile == "full":
        return names
    return {name for name in names if name in CORE_PROFILE_SKILLS}


def _section_slices(names: set[str], templates: list[_SkillTemplate]) -> list[SectionSlice]:
    slices: list[SectionSlice] = []
    for template in templates:
        if template.name not in names:
            continue
        for heading, body in _split_sections(template.content):
            slices.append(SectionSlice(template.name, heading, body))
    return slices


def _heading_repetition(slices: list[SectionSlice]) -> list[dict[str, object]]:
    grouped: dict[str, list[str]] = {}
    for section in slices:
        grouped.setdefault(section.heading, []).append(section.body)
    rows: list[dict[str, object]] = []
    for heading, bodies in grouped.items():
        total_bytes = sum(len(body) for body in bodies)
        distinct = set(bodies)
        unique_bytes = sum(len(body) for body in distinct)
        rows.append(
            {
                "heading": heading,
                "occurrences": len(bodies),
                "distinct_bodies": len(distinct),
                "bytes": total_bytes,
                "unique_bytes": unique_bytes,
                "duplicate_bytes": total_bytes - unique_bytes,
                "estimated_duplicate_tokens": _estimated_tokens(total_bytes - unique_bytes),
            }
        )
    rows.sort(key=lambda row: (-int(row["duplicate_bytes"]), str(row["heading"])))
    return rows


def _reference_payload(names: set[str], reference_templates: list[_SkillReferenceTemplate]) -> dict[str, object]:
    templates = [
        template for template in reference_templates if template.skill_name in names
    ]
    total_chars = sum(len(template.content) for template in templates)
    total_lines = sum(len(template.content.splitlines()) for template in templates)
    return {
        "file_count": len(templates),
        **_size_payload(total_chars, total_lines),
        "files": sorted(
            f"{omh_skill_display_name(template.skill_name)}/{template.relative_path}" for template in templates
        ),
    }


def _percent(part: int, whole: int) -> float:
    if whole <= 0:
        return 0.0
    return round(part * 100 / whole, 2)


def _skill_context_cost_profile(
    profile: str,
    templates: list[_SkillTemplate],
    reference_templates: list[_SkillReferenceTemplate],
) -> dict[str, object]:
    names = _profile_skill_names(profile, templates)
    slices = _section_slices(names, templates)
    headings = _heading_repetition(slices)
    total_chars = sum(len(section.body) for section in slices)
    total_lines = sum(len(section.body.splitlines()) for section in slices)
    duplicate_bytes = sum(int(row["duplicate_bytes"]) for row in headings)
    return {
        "profile": profile,
        "skill_count": len(names),
        "skill_body": _size_payload(total_chars, total_lines),
        "repeated": {
            **_size_payload(duplicate_bytes, 0),
            "share_percent": _percent(duplicate_bytes, total_chars),
        },
        "skill_specific": {
            **_size_payload(total_chars - duplicate_bytes, 0),
            "share_percent": _percent(total_chars - duplicate_bytes, total_chars),
        },
        "references": _reference_payload(names, reference_templates),
        "headings": headings,
    }


def skill_context_cost_profile(profile: str) -> dict[str, object]:
    return _skill_context_cost_profile(profile, builtin_skill_templates(), builtin_skill_reference_templates())


def skill_context_cost_payload() -> dict[str, object]:
    templates = builtin_skill_templates()
    reference_templates = builtin_skill_reference_templates()
    return {
        "schema_version": SKILL_CONTEXT_COST_SCHEMA_VERSION,
        "description": (
            "Deterministic prompt-context accounting for generated skill bodies. Byte counts are exact; "
            "token counts are a chars/4 estimate for before/after comparison, not tokenizer output. "
            "Reference files are progressive-disclosure surfaces and are reported outside the "
            "always-loaded skill-body total."
        ),
        "chars_per_token_estimate": CHARS_PER_TOKEN_ESTIMATE,
        "profiles": [
            _skill_context_cost_profile(profile, templates, reference_templates) for profile in ("core", "full")
        ],
    }


def skill_context_cost_markdown() -> str:
    payload = skill_context_cost_payload()
    lines = [
        "# Generated Skill Context Cost",
        "",
        str(payload["description"]),
        "",
    ]
    for profile in payload["profiles"]:
        body = profile["skill_body"]
        repeated = profile["repeated"]
        specific = profile["skill_specific"]
        references = profile["references"]
        lines.extend(
            [
                f"## {profile['profile']} profile",
                "",
                f"- Installed skills: {profile['skill_count']}",
                f"- Always-loaded skill body: {body['bytes']} bytes, {body['lines']} lines, "
                f"~{body['estimated_tokens']} tokens",
                f"- Repeated across skills: {repeated['bytes']} bytes "
                f"(~{repeated['estimated_tokens']} tokens, {repeated['share_percent']}%)",
                f"- Skill-specific: {specific['bytes']} bytes "
                f"(~{specific['estimated_tokens']} tokens, {specific['share_percent']}%)",
                f"- On-demand references: {references['file_count']} files, {references['bytes']} bytes "
                f"(~{references['estimated_tokens']} tokens)",
                "",
                "| Heading | Occurrences | Distinct bodies | Bytes | Duplicate bytes |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for row in profile["headings"]:
            lines.append(
                f"| {row['heading']} | {row['occurrences']} | {row['distinct_bodies']} | "
                f"{row['bytes']} | {row['duplicate_bytes']} |"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
