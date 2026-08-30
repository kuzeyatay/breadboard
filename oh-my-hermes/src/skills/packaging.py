from __future__ import annotations

from functools import lru_cache

from .catalog import installable_skill_definitions
from .render import (
    SkillReferenceTemplate,
    SkillTemplate,
    deep_interview_skill,
    memory_new_skill,
    memory_sync_skill,
    router_reference_templates,
    router_skill,
    wiki_reference_templates,
    wiki_skill,
    workflow_skill,
)


def builtin_skill_templates() -> list[SkillTemplate]:
    return list(_builtin_skill_templates_cached())


def builtin_skill_reference_templates() -> list[SkillReferenceTemplate]:
    return [*router_reference_templates(), *wiki_reference_templates()]


def _skill_template_for(name: str) -> SkillTemplate:
    if name == "deep-interview":
        return deep_interview_skill()
    if name == "memory-new":
        return memory_new_skill()
    if name == "memory-sync":
        return memory_sync_skill()
    if name == "wiki":
        return wiki_skill()
    return workflow_skill(name)


@lru_cache(maxsize=1)
def _builtin_skill_templates_cached() -> tuple[SkillTemplate, ...]:
    names = [definition.name for definition in installable_skill_definitions()]
    return (router_skill(), *[_skill_template_for(name) for name in names if name != "oh-my-hermes"])
