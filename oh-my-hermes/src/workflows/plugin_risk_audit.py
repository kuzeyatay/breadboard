from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Final, Literal, TypeAlias

from .plugin_audit_source_io import PluginAuditSource, read_static_plugin_sources, resolve_plugin_audit_root


PLUGIN_RISK_AUDIT_SCHEMA_VERSION: Final = "plugin_risk_audit/v1"
_HOOK_CAPABILITY = re.compile(r"\b(?:on_session_end|pre_llm_call|pre_tool_call)\b")
_PROCESS_EXECUTION = re.compile(
    r"\b(?:os\.system|subprocess\.(?:call|check_call|check_output|Popen|run)|child_process\.(?:exec|execFile|fork|spawn))\s*\("
)
_DYNAMIC_EXECUTION = re.compile(r"(?<!\.)\b(?:compile|eval|exec)\s*\(|\bnew\s+Function\s*\(")
_NETWORK_REQUEST = re.compile(
    r"\b(?:axios|httpx|requests|urllib(?:\.request|3)?|https?|http)\.(?:get|post|put|request|urlopen)\s*\(|\bfetch\s*\("
)
_SECRET_ASSIGNMENT = re.compile(
    r"\b(?:api[_-]?key|password|private[_-]?key|secret|token)\b\s*[:=]\s*['\"][A-Za-z0-9_-]{16,}['\"]",
    re.IGNORECASE,
)
_DEPENDENCY_DECLARATION = re.compile(r"(?:^\s*dependencies\s*=|^\s*[A-Za-z0-9_.-]+\s*(?:[<>=!~]|$))", re.MULTILINE)
_PACKAGE_DEPENDENCY_FIELDS: Final = frozenset({"dependencies", "optionalDependencies", "peerDependencies"})

JsonValue: TypeAlias = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]
ManifestStatus: TypeAlias = Literal["invalid_json", "missing", "present"]
RiskCategory: TypeAlias = Literal[
    "declared_dependency",
    "dynamic_code_execution",
    "hermes_hook_capability",
    "network_request",
    "potential_committed_secret",
    "process_execution",
]


@dataclass(frozen=True, slots=True)
class _StaticSource:
    manifest_status: ManifestStatus | None
    byte_count: int
    risk_categories: frozenset[RiskCategory]


def audit_plugin_risk(plugin_root: Path) -> JsonObject:
    root = resolve_plugin_audit_root(plugin_root)
    sources = tuple(_audit_static_source(source) for source in read_static_plugin_sources(root))
    categories = sorted({category for source in sources for category in source.risk_categories})
    return {
        "schema_version": PLUGIN_RISK_AUDIT_SCHEMA_VERSION,
        "source": {
            "explicit_root": True,
            "manifest_status": _manifest_status(sources),
        },
        "summary": {
            "scanned_file_count": len(sources),
            "scanned_byte_count": sum(source.byte_count for source in sources),
            "risk_categories": categories,
            "risk_category_count": len(categories),
        },
        "not_observed": {
            "plugin_import": {"status": "not_observed"},
            "plugin_registration": {"status": "not_observed"},
            "plugin_execution": {"status": "not_observed"},
            "dependency_installation": {"status": "not_observed"},
            "network_access": {"status": "not_observed"},
            "ci_annotation_publication": {"status": "not_observed"},
        },
        "claim_boundary": (
            "The audit statically reads bounded text from one explicitly named local plugin directory and returns only "
            "aggregate risk categories. It does not expose plugin source, import or execute plugin code, register a "
            "plugin, install dependencies, access a network, publish CI annotations, or prove that the plugin is safe."
        ),
    }


def _audit_static_source(source: PluginAuditSource) -> _StaticSource:
    text = source.content.decode("utf-8", errors="replace")
    return _StaticSource(
        _source_manifest_status(source.name, source.is_root_file, text),
        len(source.content),
        _risk_categories(source.name, text),
    )


def _source_manifest_status(name: str, is_root_file: bool, text: str) -> ManifestStatus | None:
    if name != "plugin.json" or not is_root_file:
        return None
    try:
        json.loads(text)
    except json.JSONDecodeError:
        return "invalid_json"
    return "present"


def _risk_categories(name: str, text: str) -> frozenset[RiskCategory]:
    categories: set[RiskCategory] = set()
    if _declares_dependencies(name, text):
        categories.add("declared_dependency")
    if _HOOK_CAPABILITY.search(text):
        categories.add("hermes_hook_capability")
    if _PROCESS_EXECUTION.search(text):
        categories.add("process_execution")
    if _DYNAMIC_EXECUTION.search(text):
        categories.add("dynamic_code_execution")
    if _NETWORK_REQUEST.search(text):
        categories.add("network_request")
    if _SECRET_ASSIGNMENT.search(text):
        categories.add("potential_committed_secret")
    return frozenset(categories)


def _declares_dependencies(name: str, text: str) -> bool:
    if name in {"pyproject.toml", "requirements.txt", "setup.cfg", "setup.py"}:
        return _DEPENDENCY_DECLARATION.search(text) is not None
    if name != "package.json":
        return False
    try:
        package = json.loads(text)
    except json.JSONDecodeError:
        return False
    return isinstance(package, dict) and any(
        isinstance(package.get(field), dict) and package[field] for field in _PACKAGE_DEPENDENCY_FIELDS
    )


def _manifest_status(sources: tuple[_StaticSource, ...]) -> ManifestStatus:
    statuses = {source.manifest_status for source in sources if source.manifest_status is not None}
    if "invalid_json" in statuses:
        return "invalid_json"
    if "present" in statuses:
        return "present"
    return "missing"
