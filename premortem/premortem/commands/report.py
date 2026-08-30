from __future__ import annotations

from pathlib import Path

import typer

from ..report_context import build_report_context
from ..report_renderers import render_html, render_markdown as render_report_markdown
from ..renderer import render_markdown, render_kv_panel
from ..store import PremortemError
from .common import HumanOption, ProjectDirOption, QuietOption, fail, finish, should_emit_json, store_for

app = typer.Typer(help="Export reporting context and optional convenience renderings.")


def _write_context(store, output: Path | None) -> tuple[dict, list[str], Path, Path]:
    context, warnings = build_report_context(store)
    canonical_path = store.root / "output" / "report-context.json"
    out_path = output or canonical_path
    store.write_json(out_path, context)
    if out_path != canonical_path:
        store.write_json(canonical_path, context)
    return context, warnings, out_path, canonical_path


@app.command("context")
def generate_context(
    output: Path | None = typer.Option(
        None,
        "--output",
        "-o",
        help="Write the reporting bundle here. Defaults to .premortem/output/report-context.json.",
    ),
    project_dir: Path | None = ProjectDirOption,
    human: bool = HumanOption,
    quiet: bool = QuietOption,
) -> None:
    """Export structured evidence and instructions for a report-writing agent."""
    command = "report context"
    json_flag = should_emit_json(human)
    store = store_for(project_dir)
    try:
        context, warnings, out_path, canonical_path = _write_context(store, output)
    except PremortemError as err:
        fail(command, err, json_flag)
    data = {
        "object_type": context["object_type"],
        "output_path": str(out_path),
        "canonical_output_path": str(canonical_path),
        "counts": {
            "personas": len(context["evidence"]["personas"]),
            "reasons": len(context["evidence"]["reasons"]),
            "nodes": len(context["causal_graph"]["nodes"]),
            "edges": len(context["causal_graph"]["edges"]),
            "mitigations": len(context["assessment"]["mitigations"]),
            "research_items": len((context["evidence"]["research_agenda"] or {}).get("rows", [])),
        },
        "reporting_brief": context["reporting_brief"],
    }
    if json_flag:
        finish(command, data, True, quiet, warnings=warnings)
        return
    if not quiet:
        render_kv_panel(
            "Report context",
            [
                ("Output", str(out_path)),
                ("Risks ranked", str(len(context["assessment"]["risk_ranking"]))),
                ("Causal paths", str(len(context["causal_graph"]["paths"]))),
            ],
        )


@app.command("generate")
def generate_markdown(
    output: Path | None = typer.Option(None, "--output", "-o", help="Write Markdown to this file."),
    project_dir: Path | None = ProjectDirOption,
    human: bool = HumanOption,
    quiet: bool = QuietOption,
) -> None:
    """Generate convenience Markdown from the canonical report context."""
    command = "report generate"
    json_flag = should_emit_json(human)
    store = store_for(project_dir)
    try:
        context, warnings = build_report_context(store)
        markdown = render_report_markdown(context)
        if output:
            store.write_text(output, markdown + "\n")
    except PremortemError as err:
        fail(command, err, json_flag)
    if json_flag:
        finish(command, {"markdown": markdown, "output_path": str(output) if output else None}, True, quiet, warnings=warnings)
        return
    if not quiet:
        if output:
            render_kv_panel("Markdown report", [("Output", str(output))])
        else:
            render_markdown(markdown)


@app.command("html")
def generate_html(
    output: Path | None = typer.Option(None, "--output", "-o", help="Write HTML to this file."),
    project_dir: Path | None = ProjectDirOption,
    human: bool = HumanOption,
    quiet: bool = QuietOption,
) -> None:
    """Generate convenience HTML from the canonical report context."""
    command = "report html"
    json_flag = should_emit_json(human)
    store = store_for(project_dir)
    try:
        context, warnings = build_report_context(store)
        out_path = output or (store.root / "output" / "report.html")
        store.write_text(out_path, render_html(context))
    except PremortemError as err:
        fail(command, err, json_flag)
    data = {"format": "html", "output_path": str(out_path)}
    if json_flag:
        finish(command, data, True, quiet, warnings=warnings)
        return
    if not quiet:
        render_kv_panel("HTML report", [("Output", str(out_path))])
