from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .store import ProjectStore, now_utc

RATING_NUMERIC = {"low": 1, "medium": 2, "high": 3}


def _models(items: list[Any]) -> list[dict[str, Any]]:
    return [item.model_dump(mode="json") for item in items]


def _optional_json(path: Path, warnings: list[str]) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        warnings.append(f"Could not read optional reporting source {path}: {exc}")
        return None
    return value if isinstance(value, dict) else {"value": value}


def _causal_paths(nodes: list[Any], edges: list[Any], limit: int = 100) -> list[list[str]]:
    node_ids = {node.id for node in nodes}
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    incoming_count = {node_id: 0 for node_id in node_ids}
    for edge in edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            continue
        outgoing[edge.source].append(edge.target)
        incoming_count[edge.target] += 1
    roots = sorted(node_id for node_id, count in incoming_count.items() if count == 0)
    paths: list[list[str]] = []

    def walk(node_id: str, path: list[str]) -> None:
        if len(paths) >= limit:
            return
        targets = sorted(target for target in outgoing[node_id] if target not in path)
        if not targets:
            paths.append([*path, node_id])
            return
        for target in targets:
            walk(target, [*path, node_id])

    for root in roots:
        walk(root, [])
    return paths


def build_report_context(store: ProjectStore) -> tuple[dict[str, Any], list[str]]:
    store.require_project()
    meta = store.read_meta()
    personas = store.list_personas()
    reasons = store.list_reasons()
    nodes = store.list_nodes()
    edges = store.list_edges()
    scores = store.list_scores()
    mitigations = store.list_mitigations()
    warnings: list[str] = []

    node_map = {node.id: node for node in nodes}
    score_map = {score.node_id: score for score in scores}
    mitigation_map: dict[str, list[str]] = {node.id: [] for node in nodes}
    for mitigation in mitigations:
        for node_id in mitigation.node_ids:
            if node_id in mitigation_map:
                mitigation_map[node_id].append(mitigation.id)

    risk_ranking: list[dict[str, Any]] = []
    for node in nodes:
        score = score_map.get(node.id)
        if score is None:
            continue
        numeric_score = RATING_NUMERIC[score.likelihood] * RATING_NUMERIC[score.impact]
        risk_ranking.append(
            {
                "node_id": node.id,
                "label": node.label,
                "likelihood": score.likelihood,
                "impact": score.impact,
                "risk_score": numeric_score,
                "reason_ids": list(node.reason_ids),
                "mitigation_ids": sorted(mitigation_map[node.id]),
            }
        )
    risk_ranking.sort(key=lambda item: (-item["risk_score"], item["node_id"]))

    output_dir = store.root / "output"
    research_path = output_dir / "results_research_agenda.json"
    summary_path = output_dir / "results_exec_summary.json"
    research = _optional_json(research_path, warnings)
    summary = _optional_json(summary_path, warnings)
    reason_ids = {reason.id for reason in reasons}
    cited_reason_ids = {reason_id for node in nodes for reason_id in node.reason_ids}

    context = {
        "schema_version": "1.0",
        "object_type": "premortem_report_context",
        "generated_at": now_utc().isoformat(),
        "project": meta.model_dump(mode="json"),
        "evidence": {
            "personas": _models(personas),
            "reasons": _models(reasons),
            "research_agenda": research,
            "candidate_executive_summary": summary,
        },
        "causal_graph": {
            "nodes": _models(nodes),
            "edges": _models(edges),
            "root_node_ids": sorted(
                node.id for node in nodes if not any(edge.target == node.id for edge in edges)
            ),
            "terminal_node_ids": sorted(
                node.id for node in nodes if not any(edge.source == node.id for edge in edges)
            ),
            "paths": _causal_paths(nodes, edges),
        },
        "assessment": {
            "scores": _models(scores),
            "risk_ranking": risk_ranking,
            "mitigations": _models(mitigations),
            "coverage": {
                "unscored_node_ids": sorted(node.id for node in nodes if node.id not in score_map),
                "unmitigated_node_ids": sorted(node.id for node in nodes if not mitigation_map[node.id]),
                "uncited_reason_ids": sorted(reason_ids - cited_reason_ids),
                "unknown_reason_ids_cited_by_nodes": sorted(cited_reason_ids - reason_ids),
                "unknown_node_ids_cited_by_mitigations": sorted(
                    {
                        node_id
                        for mitigation in mitigations
                        for node_id in mitigation.node_ids
                        if node_id not in node_map
                    }
                ),
            },
        },
        "reporting_brief": {
            "purpose": "Write a decision-ready report from this structured pre-mortem record.",
            "required_sections": [
                "decision and recommendation",
                "initiative and imagined failure",
                "principal causal pathways",
                "highest-priority risks",
                "mitigations and owners",
                "research required before commitment",
                "limitations",
            ],
            "instructions": [
                "Treat the failure statement as a prospective-hindsight scenario, not a prediction.",
                "Use entity IDs when connecting claims to reasons, nodes, scores, or mitigations.",
                "Distinguish synthetic stakeholder perspectives from observed empirical evidence.",
                "Do not invent facts, owners, costs, probabilities, or research findings.",
                "Treat the candidate executive summary as source material, not authoritative prose.",
                "Surface missing scores, mitigation coverage, and unresolved assumptions.",
                "Adapt tone and format to the requested audience while preserving traceability.",
            ],
        },
        "provenance": {
            "project_store": str(store.root),
            "source_paths": {
                "project": str(store.meta_path),
                "personas": str(store.root / "personas"),
                "reasons": str(store.root / "reasons"),
                "graph_nodes": str(store.root / "graph" / "nodes"),
                "graph_edges": str(store.root / "graph" / "edges"),
                "scores": str(store.root / "scores"),
                "mitigations": str(store.root / "mitigations"),
                "research_agenda": str(research_path) if research_path.exists() else None,
                "candidate_executive_summary": str(summary_path) if summary_path.exists() else None,
            },
        },
    }
    return context, warnings
