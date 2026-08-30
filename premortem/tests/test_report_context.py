from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

from typer.testing import CliRunner

from premortem.cli import app
from premortem import workflow
from premortem.models import Edge, Mitigation, Node, Persona, ProjectMeta, Reason, Score
from premortem.report_context import build_report_context
from premortem.store import ProjectStore


runner = CliRunner()
NOW = datetime(2026, 7, 24, tzinfo=timezone.utc)


def populated_store(tmp_path) -> ProjectStore:
    store = ProjectStore(tmp_path / ".premortem")
    store.init_project(
        ProjectMeta(
            id="pm_test",
            initiative="Colgate Kitchen",
            description="Launch heat-and-serve entrées.",
            failure_statement="It is one year later. The entrée line has been withdrawn.",
            created_at=NOW,
            updated_at=NOW,
        )
    )
    store.save_persona(Persona(id="p001", name="Avery", role="Retail buyer", created_at=NOW))
    store.save_reason(
        Reason(
            id="r001",
            persona_id="p001",
            kind="episodic",
            text="Retail buyers refuse a second order after weak trial.",
            created_at=NOW,
        )
    )
    store.save_reason(
        Reason(
            id="r002",
            persona_id="p001",
            kind="structural",
            text="The brand architecture rewards category extension without testing category permission.",
            created_at=NOW,
        )
    )
    store.save_node(
        Node(id="n001", label="Brand suppresses trial", reason_ids=["r001"], created_at=NOW)
    )
    store.save_node(Node(id="n002", label="Retailers discontinue line", created_at=NOW))
    store.save_edge(
        Edge(id="e001", source="n001", target="n002", label="weak velocity", created_at=NOW)
    )
    store.save_score(Score(node_id="n001", likelihood="high", impact="high", created_at=NOW))
    store.save_mitigation(
        Mitigation(
            id="m001",
            text="Run a blind concept and taste test before sell-in.",
            node_ids=["n001"],
            created_at=NOW,
        )
    )
    output_dir = store.root / "output"
    (output_dir / "results_research_agenda.json").write_text(
        json.dumps({"entity_type": "research_agenda", "rows": [{"text": "Test brand acceptance."}]})
    )
    return store


def test_report_context_preserves_evidence_and_derivations(tmp_path) -> None:
    context, warnings = build_report_context(populated_store(tmp_path))

    assert warnings == []
    assert context["object_type"] == "premortem_report_context"
    assert context["evidence"]["reasons"][0]["id"] == "r001"
    assert context["causal_graph"]["paths"] == [["n001", "n002"]]
    assert context["assessment"]["risk_ranking"][0]["risk_score"] == 9
    assert context["assessment"]["risk_ranking"][0]["mitigation_ids"] == ["m001"]
    assert context["assessment"]["coverage"]["unscored_node_ids"] == ["n002"]
    assert context["reporting_brief"]["instructions"]


def test_report_context_command_writes_bundle(monkeypatch, tmp_path) -> None:
    store = populated_store(tmp_path)
    output = tmp_path / "writeup" / "context.json"
    assert workflow.infer_phase(store) == "report-context"
    argv = [
        "premortem",
        "report",
        "context",
        "--project-dir",
        str(store.root),
        "--output",
        str(output),
    ]
    monkeypatch.setattr(sys, "argv", argv)

    result = runner.invoke(app, argv[1:])

    assert result.exit_code == 0
    envelope = json.loads(result.stdout)
    bundle = json.loads(output.read_text())
    assert envelope["data"]["output_path"] == str(output)
    assert envelope["data"]["canonical_output_path"] == str(store.root / "output" / "report-context.json")
    assert envelope["data"]["counts"]["nodes"] == 2
    assert bundle["project"]["initiative"] == "Colgate Kitchen"
    assert workflow.infer_phase(store) == "complete"


def test_default_context_completes_workflow(monkeypatch, tmp_path) -> None:
    store = populated_store(tmp_path)
    monkeypatch.setattr(
        sys,
        "argv",
        ["premortem", "report", "context", "--project-dir", str(store.root)],
    )

    result = runner.invoke(app, ["report", "context", "--project-dir", str(store.root)])

    assert result.exit_code == 0
    assert (store.root / "output" / "report-context.json").exists()
    assert workflow.infer_phase(store) == "complete"

    reason_path = store.reason_path("r001")
    context_mtime = (store.root / "output" / "report-context.json").stat().st_mtime_ns
    os.utime(reason_path, ns=(context_mtime + 1, context_mtime + 1))
    assert workflow.infer_phase(store) == "report-context"


def test_report_renderers_use_canonical_context(monkeypatch, tmp_path) -> None:
    store = populated_store(tmp_path)
    html_output = tmp_path / "report.html"
    markdown_output = tmp_path / "report.md"

    html_result = runner.invoke(
        app,
        [
            "report",
            "html",
            "--project-dir",
            str(store.root),
            "--output",
            str(html_output),
        ],
    )
    markdown_result = runner.invoke(
        app,
        [
            "report",
            "generate",
            "--project-dir",
            str(store.root),
            "--output",
            str(markdown_output),
        ],
    )

    assert html_result.exit_code == 0
    assert markdown_result.exit_code == 0
    assert "Colgate Kitchen" in html_output.read_text()
    assert "# Pre-mortem: Colgate Kitchen" in markdown_output.read_text()
