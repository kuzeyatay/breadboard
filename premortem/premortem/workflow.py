from __future__ import annotations

from pathlib import Path
from typing import Any

from .store import PremortemError
from .store import ProjectStore
from .validation import validation_data


CHECKLISTS: dict[str, list[str]] = {
    "init": [
        "Extract initiative name, description, stakeholders, timeline, and success criteria.",
        "Draft a definitive failure statement as completed fact.",
        "Remove causes and hedging from the failure statement.",
        "Run premortem init.",
    ],
    "personas": [
        "Build a model-free personas.jobs.ep package.",
        "Inspect and estimate the package, run it with ep, and ingest personas-results.ep.",
        "Review 4-6 personas for specificity and conflicting incentives.",
        "Ask the user to approve the persona panel before reasons.",
    ],
    "reasons": [
        "Build a model-free reasons.jobs.ep package with domain details and a strong good example.",
        "Inspect and estimate the package, run it with ep, and ingest reasons-results.ep.",
        "Confirm reasons are rich narratives, not generic bullets.",
    ],
    "causal-graph": [
        "Read failure reasons and synthesize about 8 causal nodes.",
        "Add 3-4 root causes, 2-3 intermediate effects, and 1-2 terminal outcomes.",
        "Add about 10 directed edges with concise mechanism labels.",
        "Review graph readability and ask the user before locking it.",
    ],
    "scoring": [
        "Review the causal graph before scoring.",
        "Score the nodes that materially influence the decision.",
        "Explain the basis for likelihood and impact ratings in notes.",
    ],
    "mitigations": [
        "Build a model-free mitigations.jobs.ep package.",
        "Require mitigations to mention target node IDs.",
        "Inspect and estimate the package, run it with ep, and ingest mitigations-results.ep.",
        "Review unassigned mitigations and map them to nodes where appropriate.",
    ],
    "research-agenda": [
        "Build, inspect, run, and ingest a research-agenda .ep job.",
        "Check that each item has an assumption, method, population, and decision threshold.",
    ],
    "report-context": [
        "Export the canonical report-context JSON bundle.",
        "Check coverage gaps and optional source-material warnings.",
        "Give the bundle to a writing agent with the audience and desired format.",
        "Treat direct Markdown or HTML rendering as optional convenience output.",
    ],
    "repair": [
        "Run premortem workflow validate.",
        "Repair dangling references, duplicate edges, self-loops, or causal cycles.",
        "Rerun validation before continuing the analysis.",
    ],
}


PHASE_DOCS = {
    "intake": "facilitation-guide",
    "init": "failure-statement",
    "personas": "personas",
    "reasons": "failure-reasons",
    "causal-graph": "causal-graph",
    "scoring": "causal-graph",
    "mitigations": "mitigations",
    "research-agenda": "research-agenda",
    "report-context": "reporting",
    "repair": "overview",
}


INTAKE_CHECKLIST = [
    "Begin by asking only what planned initiative should be analyzed.",
    "From the answer, identify the one or two missing details that would most change the analysis.",
    "Ask tailored follow-ups and suggest plausible assumptions for the user to confirm or correct; do not present a context checklist.",
    "Draft a concise initiative name, description, and completed-fact failure statement for user approval.",
    "After approval, run premortem init with the drafted values.",
]


def project_counts(store: ProjectStore) -> dict[str, int]:
    reasons = store.list_reasons()
    return {
        "personas": len(store.list_personas()),
        "reasons_episodic": len([r for r in reasons if r.kind == "episodic"]),
        "reasons_structural": len([r for r in reasons if r.kind == "structural"]),
        "graph_nodes": len(store.list_nodes()),
        "graph_edges": len(store.list_edges()),
        "scores": len(store.list_scores()),
        "mitigations": len(store.list_mitigations()),
    }


def infer_phase(store: ProjectStore) -> str:
    store.require_project()
    validation = validation_data(store)
    if validation["errors"]:
        return "repair"
    counts = project_counts(store)
    output_dir = store.root / "output"
    if counts["personas"] == 0:
        return "personas"
    if counts["reasons_episodic"] == 0 or counts["reasons_structural"] == 0:
        return "reasons"
    if counts["graph_nodes"] < 2 or counts["graph_edges"] == 0:
        return "causal-graph"
    if counts["scores"] == 0:
        return "scoring"
    if counts["mitigations"] == 0:
        return "mitigations"
    if not (output_dir / "results_research_agenda.json").exists():
        return "research-agenda"
    if not _report_context_is_current(store):
        return "report-context"
    return "complete"


def _report_context_is_current(store: ProjectStore) -> bool:
    context_path = store.root / "output" / "report-context.json"
    if not context_path.exists():
        return False
    source_paths = [
        store.meta_path,
        *store.root.glob("personas/*.json"),
        *store.root.glob("reasons/*.json"),
        *store.root.glob("graph/nodes/*.json"),
        *store.root.glob("graph/edges/*.json"),
        *store.root.glob("scores/*.json"),
        *store.root.glob("mitigations/*.json"),
        *store.root.glob("output/results_research_agenda.json"),
        *store.root.glob("output/results_exec_summary.json"),
    ]
    context_mtime = context_path.stat().st_mtime_ns
    return all(path.stat().st_mtime_ns <= context_mtime for path in source_paths if path.exists())


def artifacts(store: ProjectStore) -> list[dict[str, Any]]:
    study_root = store.root.parent if store.root.name == ".premortem" else store.root
    expected_paths: list[tuple[Path, str]] = [
        (store.root / "output" / "results_personas.json", "premortem_output"),
        (store.root / "output" / "results_reasons.json", "premortem_output"),
        (store.root / "output" / "results_mitigations.json", "premortem_output"),
        (store.root / "output" / "results_research_agenda.json", "premortem_output"),
        (store.root / "output" / "results_exec_summary.json", "premortem_output"),
        (store.root / "output" / "report-context.json", "premortem_output"),
        (store.root / "output" / "report.html", "premortem_output"),
        (study_root / "writeup" / "report.md", "macaw_writeup"),
        (study_root / "writeup" / "premortem_report.html", "macaw_writeup"),
        (study_root / "writeup" / "plots" / "causal_graph.png", "macaw_writeup"),
    ]
    records: list[dict[str, Any]] = [
        {
            "path": str(path),
            "exists": path.exists(),
            "size": path.stat().st_size if path.exists() and path.is_file() else None,
            "source": source,
        }
        for path, source in expected_paths
    ]
    # When running inside a macaw task, additionally surface every existing
    # file under the standard macaw subdirs (`writeup/`, `analysis/`, `data/`)
    # so `workflow artifacts` reports them even when the names don't match
    # premortem's expected file list.
    macaw_root = _macaw_task_root(store)
    if macaw_root is not None:
        seen = {record["path"] for record in records}
        for subdir, source in (
            ("writeup", "macaw_writeup"),
            ("analysis", "macaw_analysis"),
            ("data", "macaw_data"),
        ):
            base = macaw_root / subdir
            if not base.exists():
                continue
            for path in sorted(base.rglob("*")):
                if not path.is_file():
                    continue
                key = str(path)
                if key in seen:
                    continue
                seen.add(key)
                records.append(
                    {
                        "path": key,
                        "exists": True,
                        "size": path.stat().st_size,
                        "source": source,
                    }
                )
    return records


def _macaw_task_root(store: ProjectStore) -> Path | None:
    if store.root.name == ".premortem":
        candidate = store.root.parent
        if (candidate / ".macaw_task").exists() or (candidate / "writeup").exists():
            return candidate
    return None


def next_steps(phase: str) -> list[dict[str, str]]:
    by_phase: dict[str, list[dict[str, str]]] = {
        "intake": [
            {"label": "Read the facilitation guide", "command": "premortem docs show facilitation-guide"},
            {"label": "Ask the opening question", "command": "Ask only: What planned initiative should we analyze?"},
            {"label": "Tailor follow-ups", "command": "Based on the answer, suggest assumptions and ask one or two questions about only the details that would most change the analysis."},
            {"label": "Draft failure statement", "command": "Draft a completed-fact failure statement and ask the user to approve it."},
            {"label": "Initialize after approval", "command": "premortem init --initiative \"...\" --failure \"...\" --description \"...\""},
        ],
        "personas": [
            {"label": "Build personas Jobs", "command": "premortem job generate personas --context \"...\" --requirements \"...\" --output jobs/personas.jobs.ep"},
            {"label": "Inspect personas Jobs", "command": "ep inspect jobs/personas.jobs.ep"},
            {"label": "Estimate run cost", "command": "ep jobs cost jobs/personas.jobs.ep"},
            {"label": "Run after model approval", "command": "ep run jobs/personas.jobs.ep --model <model-name> --output jobs/personas-results.ep"},
            {"label": "Ingest personas", "command": "premortem ingest personas --from jobs/personas-results.ep"},
        ],
        "reasons": [
            {"label": "Build reasons Jobs", "command": "premortem job generate reasons --domain \"...\" --good-example \"...\" --output jobs/reasons.jobs.ep"},
            {"label": "Inspect reasons Jobs", "command": "ep inspect jobs/reasons.jobs.ep"},
            {"label": "Estimate run cost", "command": "ep jobs cost jobs/reasons.jobs.ep"},
            {"label": "Run after model approval", "command": "ep run jobs/reasons.jobs.ep --model <model-name> --output jobs/reasons-results.ep"},
            {"label": "Ingest reasons", "command": "premortem ingest reasons --from jobs/reasons-results.ep"},
        ],
        "causal-graph": [
            {"label": "Review reasons", "command": "premortem reason list --human"},
            {"label": "Add nodes", "command": "premortem graph add-node --label \"...\" --reason r001"},
            {"label": "Add edges", "command": "premortem graph add-edge --from n001 --to n004 --label \"...\""},
        ],
        "scoring": [
            {"label": "Review graph", "command": "premortem graph list --human"},
            {
                "label": "Score a decision-relevant node",
                "command": "premortem score set --node n001 --likelihood high --impact high --notes \"...\"",
            },
        ],
        "mitigations": [
            {"label": "Build mitigations Jobs", "command": "premortem job generate mitigations --good-example \"...\" --output jobs/mitigations.jobs.ep"},
            {"label": "Inspect mitigations Jobs", "command": "ep inspect jobs/mitigations.jobs.ep"},
            {"label": "Estimate run cost", "command": "ep jobs cost jobs/mitigations.jobs.ep"},
            {"label": "Run after model approval", "command": "ep run jobs/mitigations.jobs.ep --model <model-name> --output jobs/mitigations-results.ep"},
            {"label": "Ingest mitigations", "command": "premortem ingest mitigations --from jobs/mitigations-results.ep"},
        ],
        "research-agenda": [
            {"label": "Build research Jobs", "command": "premortem job generate research-agenda --output jobs/research-agenda.jobs.ep"},
            {"label": "Inspect research Jobs", "command": "ep inspect jobs/research-agenda.jobs.ep"},
            {"label": "Estimate run cost", "command": "ep jobs cost jobs/research-agenda.jobs.ep"},
            {"label": "Run after model approval", "command": "ep run jobs/research-agenda.jobs.ep --model <model-name> --output jobs/research-agenda-results.ep"},
            {"label": "Ingest research agenda", "command": "premortem ingest research-agenda --from jobs/research-agenda-results.ep"},
        ],
        "report-context": [
            {"label": "Export report context", "command": "premortem report context"},
            {
                "label": "Write the audience-specific report",
                "command": "Give .premortem/output/report-context.json and the audience requirements to a report-writing agent.",
            },
        ],
        "complete": [
            {
                "label": "Write the audience-specific report",
                "command": "Give .premortem/output/report-context.json and the audience requirements to a report-writing agent.",
            },
            {"label": "Inspect status", "command": "premortem status --human"},
            {"label": "Refresh report context after changes", "command": "premortem report context"},
            {"label": "Optional quick HTML rendering", "command": "premortem report html"},
        ],
        "repair": [
            {"label": "Inspect integrity errors", "command": "premortem workflow validate"},
        ],
    }
    normalized: list[dict[str, str]] = []
    for step in by_phase.get(phase, []):
        value = step["command"]
        if value.startswith(("premortem ", "ep ")):
            normalized.append({"kind": "command", "label": step["label"], "command": value})
        else:
            normalized.append({"kind": "instruction", "label": step["label"], "instruction": value})
    return normalized


def missing_project_next(project_dir: Path) -> dict[str, Any]:
    return {
        "phase": "intake",
        "project_exists": False,
        "project_dir": str(project_dir),
        "doc_topic": "facilitation-guide",
        "checklist": INTAKE_CHECKLIST,
        "required_user_inputs": [
            "initiative to analyze",
        ],
        "facilitator_instruction": (
            "Begin by asking only what planned initiative should be analyzed. Then ask one or two tailored "
            "follow-ups, suggesting plausible assumptions for the user to confirm or correct. Do not present "
            "a context checklist or ask for a polished failure statement. Draft the completed-fact failure "
            "statement yourself, then ask the user to approve or edit it."
        ),
        "recommended_next_steps": next_steps("intake"),
    }


def phase_state(store: ProjectStore) -> dict[str, Any]:
    try:
        phase = infer_phase(store)
        return {
            "phase": phase,
            "project_exists": True,
            "counts": project_counts(store),
            "validation": validation_data(store),
            "checklist": CHECKLISTS.get(phase, []),
            "recommended_next_steps": next_steps(phase),
        }
    except PremortemError as err:
        if err.code == "ID_NOT_FOUND":
            return missing_project_next(store.root)
        raise
