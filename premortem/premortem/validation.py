from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .store import ProjectStore


class ValidationIssue(BaseModel):
    severity: Literal["error", "warning"]
    code: str
    message: str
    entity_ids: list[str] = Field(default_factory=list)


def graph_has_cycle(node_ids: set[str], pairs: list[tuple[str, str]]) -> bool:
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for source, target in pairs:
        if source in outgoing and target in node_ids:
            outgoing[source].append(target)
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> bool:
        if node_id in visiting:
            return True
        if node_id in visited:
            return False
        visiting.add(node_id)
        if any(visit(target) for target in outgoing[node_id]):
            return True
        visiting.remove(node_id)
        visited.add(node_id)
        return False

    return any(visit(node_id) for node_id in sorted(node_ids))


def validate_store(store: ProjectStore) -> list[ValidationIssue]:
    store.require_project()
    personas = store.list_personas()
    reasons = store.list_reasons()
    nodes = store.list_nodes()
    edges = store.list_edges()
    scores = store.list_scores()
    mitigations = store.list_mitigations()
    persona_ids = {item.id for item in personas}
    reason_ids = {item.id for item in reasons}
    node_ids = {item.id for item in nodes}
    issues: list[ValidationIssue] = []

    for reason in reasons:
        if reason.persona_id not in persona_ids:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="dangling_reason_persona",
                    message=f"Reason {reason.id} references missing persona {reason.persona_id}.",
                    entity_ids=[reason.id, reason.persona_id],
                )
            )
    for node in nodes:
        missing = sorted(set(node.reason_ids) - reason_ids)
        if missing:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="dangling_node_reasons",
                    message=f"Node {node.id} references missing reasons: {', '.join(missing)}.",
                    entity_ids=[node.id, *missing],
                )
            )
    seen_pairs: set[tuple[str, str]] = set()
    valid_pairs: list[tuple[str, str]] = []
    for edge in edges:
        missing = [node_id for node_id in (edge.source, edge.target) if node_id not in node_ids]
        if missing:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="dangling_edge_nodes",
                    message=f"Edge {edge.id} references missing nodes: {', '.join(missing)}.",
                    entity_ids=[edge.id, *missing],
                )
            )
            continue
        pair = (edge.source, edge.target)
        valid_pairs.append(pair)
        if edge.source == edge.target:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="self_loop",
                    message=f"Edge {edge.id} is a self-loop on {edge.source}.",
                    entity_ids=[edge.id, edge.source],
                )
            )
        if pair in seen_pairs:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="duplicate_edge",
                    message=f"More than one edge connects {edge.source} to {edge.target}.",
                    entity_ids=[edge.source, edge.target],
                )
            )
        seen_pairs.add(pair)
    if graph_has_cycle(node_ids, valid_pairs):
        issues.append(
            ValidationIssue(
                severity="error",
                code="causal_cycle",
                message="The causal graph contains a directed cycle.",
                entity_ids=[],
            )
        )
    for score in scores:
        if score.node_id not in node_ids:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="dangling_score_node",
                    message=f"Score references missing node {score.node_id}.",
                    entity_ids=[score.node_id],
                )
            )
    for mitigation in mitigations:
        missing = sorted(set(mitigation.node_ids) - node_ids)
        if missing:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="dangling_mitigation_nodes",
                    message=f"Mitigation {mitigation.id} references missing nodes: {', '.join(missing)}.",
                    entity_ids=[mitigation.id, *missing],
                )
            )

    if nodes and not edges:
        issues.append(
            ValidationIssue(
                severity="warning",
                code="graph_has_no_edges",
                message="The causal graph has nodes but no causal edges.",
                entity_ids=sorted(node_ids),
            )
        )
    scored_ids = {score.node_id for score in scores}
    unscored = sorted(node_ids - scored_ids)
    if unscored:
        issues.append(
            ValidationIssue(
                severity="warning",
                code="unscored_nodes",
                message=f"Nodes without scores: {', '.join(unscored)}.",
                entity_ids=unscored,
            )
        )
    mitigated_ids = {node_id for mitigation in mitigations for node_id in mitigation.node_ids}
    unmitigated = sorted(node_ids - mitigated_ids)
    if mitigations and unmitigated:
        issues.append(
            ValidationIssue(
                severity="warning",
                code="unmitigated_nodes",
                message=f"Nodes without mitigations: {', '.join(unmitigated)}.",
                entity_ids=unmitigated,
            )
        )
    return issues


def validation_data(store: ProjectStore) -> dict[str, Any]:
    issues = validate_store(store)
    return {
        "valid": not any(issue.severity == "error" for issue in issues),
        "errors": [issue.model_dump(mode="json") for issue in issues if issue.severity == "error"],
        "warnings": [issue.model_dump(mode="json") for issue in issues if issue.severity == "warning"],
    }
