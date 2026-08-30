from __future__ import annotations

from html import escape
from typing import Any


def _research_rows(context: dict[str, Any]) -> list[dict[str, Any]]:
    research = context["evidence"].get("research_agenda") or {}
    rows = research.get("rows", [])
    return rows if isinstance(rows, list) else []


def _research_text(row: dict[str, Any]) -> str:
    if row.get("text"):
        return str(row["text"])
    fields = [
        ("Assumption", "assumption"),
        ("Uncertainty", "uncertainty"),
        ("Method", "method"),
        ("Population", "population"),
        ("Decision threshold", "decision_threshold"),
        ("Nodes", "node_ids"),
    ]
    parts = []
    for label, key in fields:
        value = row.get(key)
        if isinstance(value, list):
            value = ", ".join(str(item) for item in value)
        if value:
            parts.append(f"{label}: {value}")
    return "\n".join(parts)


def render_markdown(context: dict[str, Any]) -> str:
    project = context["project"]
    evidence = context["evidence"]
    graph = context["causal_graph"]
    assessment = context["assessment"]
    node_map = {node["id"]: node["label"] for node in graph["nodes"]}
    persona_map = {persona["id"]: persona["name"] for persona in evidence["personas"]}
    lines = [
        f"# Pre-mortem: {project['initiative']}",
        "",
    ]
    if project.get("description"):
        lines.extend([project["description"], ""])
    lines.extend([f"**Failure statement:** {project['failure_statement']}", ""])

    lines.extend(["## Priority risks", ""])
    if assessment["risk_ranking"]:
        lines.extend(
            [
                "| Node | Risk | Likelihood | Impact | Failure mechanism |",
                "|---|---:|---|---|---|",
            ]
        )
        for item in assessment["risk_ranking"]:
            lines.append(
                f"| {item['node_id']} | {item['risk_score']} | {item['likelihood']} | "
                f"{item['impact']} | {item['label']} |"
            )
    else:
        lines.append("_No scored risks._")
    lines.append("")

    lines.extend(["## Principal causal paths", ""])
    if graph["paths"]:
        for path in graph["paths"]:
            rendered = " → ".join(f"{node_id} ({node_map.get(node_id, 'unknown')})" for node_id in path)
            lines.append(f"- {rendered}")
    else:
        lines.append("_No root-to-terminal paths are available._")
    lines.append("")

    lines.extend(["## Stakeholder perspectives", ""])
    for persona in evidence["personas"]:
        lines.append(f"### {persona['name']} — {persona['role']}")
        lines.extend(["", persona.get("perspective") or "_No perspective recorded._", ""])

    lines.extend(["## Failure evidence", ""])
    for reason in evidence["reasons"]:
        persona = persona_map.get(reason["persona_id"], reason["persona_id"])
        lines.extend(
            [
                f"### {reason['id']} — {reason['kind']} ({persona})",
                "",
                reason["text"],
                "",
            ]
        )

    lines.extend(["## Mitigations", ""])
    for mitigation in assessment["mitigations"]:
        targets = ", ".join(mitigation["node_ids"]) or "unassigned"
        lines.extend([f"- **{mitigation['id']}** → {targets}: {mitigation['text']}"])
    if not assessment["mitigations"]:
        lines.append("_No mitigations recorded._")
    lines.append("")

    lines.extend(["## Research agenda", ""])
    research_rows = _research_rows(context)
    for row in research_rows:
        owner = row.get("persona_name") or row.get("persona_id") or "Unattributed"
        lines.extend([f"### {owner}", "", _research_text(row), ""])
    if not research_rows:
        lines.extend(["_No research agenda was ingested._", ""])

    coverage = assessment["coverage"]
    lines.extend(
        [
            "## Limitations and coverage",
            "",
            "- Stakeholder personas and their statements are synthetic unless independently validated.",
            f"- Unscored nodes: {', '.join(coverage['unscored_node_ids']) or 'none'}.",
            f"- Nodes without mitigations: {', '.join(coverage['unmitigated_node_ids']) or 'none'}.",
            f"- Reasons not cited by graph nodes: {', '.join(coverage['uncited_reason_ids']) or 'none'}.",
            "",
        ]
    )
    return "\n".join(lines)


def render_html(context: dict[str, Any]) -> str:
    project = context["project"]
    evidence = context["evidence"]
    graph = context["causal_graph"]
    assessment = context["assessment"]
    node_map = {node["id"]: node["label"] for node in graph["nodes"]}
    persona_map = {persona["id"]: persona["name"] for persona in evidence["personas"]}

    risks = "".join(
        "<tr>"
        f"<td>{escape(item['node_id'])}</td>"
        f"<td>{item['risk_score']}</td>"
        f"<td>{escape(item['likelihood'])}</td>"
        f"<td>{escape(item['impact'])}</td>"
        f"<td>{escape(item['label'])}</td>"
        "</tr>"
        for item in assessment["risk_ranking"]
    ) or '<tr><td colspan="5"><em>No scored risks.</em></td></tr>'
    paths = "".join(
        "<li>"
        + " → ".join(
            f"<strong>{escape(node_id)}</strong> ({escape(node_map.get(node_id, 'unknown'))})"
            for node_id in path
        )
        + "</li>"
        for path in graph["paths"]
    ) or "<li><em>No root-to-terminal paths are available.</em></li>"
    personas = "".join(
        "<section>"
        f"<h3>{escape(persona['name'])} — {escape(persona['role'])}</h3>"
        f"<p class=\"prose\">{escape(persona.get('perspective') or 'No perspective recorded.')}</p>"
        "</section>"
        for persona in evidence["personas"]
    )
    reasons = "".join(
        "<section>"
        f"<h3>{escape(reason['id'])} — {escape(reason['kind'])} "
        f"({escape(persona_map.get(reason['persona_id'], reason['persona_id']))})</h3>"
        f"<p class=\"prose\">{escape(reason['text'])}</p>"
        "</section>"
        for reason in evidence["reasons"]
    )
    mitigations = "".join(
        "<li>"
        f"<strong>{escape(item['id'])}</strong> → "
        f"{escape(', '.join(item['node_ids']) or 'unassigned')}: "
        f"<span class=\"prose\">{escape(item['text'])}</span>"
        "</li>"
        for item in assessment["mitigations"]
    ) or "<li><em>No mitigations recorded.</em></li>"
    research = "".join(
        "<section>"
        f"<h3>{escape(str(row.get('persona_name') or row.get('persona_id') or 'Unattributed'))}</h3>"
        f"<p class=\"prose\">{escape(_research_text(row))}</p>"
        "</section>"
        for row in _research_rows(context)
    ) or "<p><em>No research agenda was ingested.</em></p>"
    coverage = assessment["coverage"]

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pre-mortem: {escape(project['initiative'])}</title>
<style>
:root{{--ink:#17211a;--muted:#5d695f;--line:#dfe5df;--accent:#176b45;--paper:#fff}}
*{{box-sizing:border-box}}body{{margin:0;color:var(--ink);background:#f4f6f4;font:16px/1.6 system-ui,sans-serif}}
main{{max-width:900px;margin:auto;padding:64px 48px 100px;background:var(--paper)}}
h1{{font-size:2.6rem;line-height:1.1}}h2{{margin-top:3rem;border-bottom:2px solid var(--accent);padding-bottom:.35rem}}
h3{{margin:1.6rem 0 .35rem;font-size:1rem}}.failure{{padding:18px;border-left:4px solid var(--accent);background:#f2f7f3}}
.prose{{white-space:pre-wrap}}table{{width:100%;border-collapse:collapse}}th,td{{padding:9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}}
th{{color:var(--muted)}}li+li{{margin-top:.65rem}}.meta{{color:var(--muted)}}@media(max-width:650px){{main{{padding:32px 20px}}}}
</style>
</head>
<body><main>
<header>
<p class="meta">Structured pre-mortem</p>
<h1>{escape(project['initiative'])}</h1>
<p>{escape(project.get('description') or '')}</p>
<p class="failure"><strong>Failure statement:</strong> {escape(project['failure_statement'])}</p>
</header>
<h2>Priority risks</h2>
<table><thead><tr><th>Node</th><th>Risk</th><th>Likelihood</th><th>Impact</th><th>Failure mechanism</th></tr></thead><tbody>{risks}</tbody></table>
<h2>Principal causal paths</h2><ol>{paths}</ol>
<h2>Stakeholder perspectives</h2>{personas}
<h2>Failure evidence</h2>{reasons}
<h2>Mitigations</h2><ul>{mitigations}</ul>
<h2>Research agenda</h2>{research}
<h2>Limitations and coverage</h2>
<ul>
<li>Stakeholder personas and their statements are synthetic unless independently validated.</li>
<li>Unscored nodes: {escape(', '.join(coverage['unscored_node_ids']) or 'none')}.</li>
<li>Nodes without mitigations: {escape(', '.join(coverage['unmitigated_node_ids']) or 'none')}.</li>
<li>Reasons not cited by graph nodes: {escape(', '.join(coverage['uncited_reason_ids']) or 'none')}.</li>
</ul>
</main></body></html>
"""
