from __future__ import annotations

from pathlib import Path

import typer

from .. import docs as docs_lib
from .. import workflow as workflow_lib
from ..renderer import render_markdown
from .common import HumanOption, ProjectDirOption, QuietOption, finish, should_emit_json, store_for

app = typer.Typer(help="Start an agent-guided premortem workflow.")


def _agent_guide() -> str:
    return docs_lib.read_topic("facilitation-guide")


@app.command("agent-start")
def agent_start(
    project_dir: Path | None = ProjectDirOption,
    human: bool = HumanOption,
    quiet: bool = QuietOption,
) -> None:
    """Return the facilitation contract, current state, and executable next actions."""
    command = "agent-start"
    json_flag = should_emit_json(human)
    state = workflow_lib.phase_state(store_for(project_dir))
    steps = state.get("recommended_next_steps", [])
    executable = [
        step["command"]
        for step in steps
        if step.get("kind") == "command"
    ]
    data = {
        "role": "Facilitate the premortem; do not expect the user to know the method.",
        "rules": [
            "Use the CLI as the source of truth; do not edit .premortem JSON directly.",
            "Read the phase guide before acting.",
            "Stop for approval after the failure statement, personas, causal graph, and before paid model runs.",
            "Build model-free .jobs.ep packages, inspect and price them, then use ep run only after approval.",
            "Run premortem workflow next after every ingest or material state change.",
            "Run premortem agent-end before handoff.",
        ],
        "state": state,
        "agent_guide": _agent_guide(),
    }
    if json_flag:
        finish(command, data, True, quiet, next_steps=executable)
        return
    if quiet:
        return
    lines = [
        "# Premortem Agent Start",
        "",
        data["role"],
        "",
        "## Rules",
        "",
        *[f"- {rule}" for rule in data["rules"]],
        "",
        "## Current phase",
        "",
        f"`{state['phase']}`",
        "",
        "## Recommended next steps",
        "",
        *[
            f"- **{step['label']}** — "
            + (f"`{step['command']}`" if step["kind"] == "command" else step["instruction"])
            for step in steps
        ],
    ]
    render_markdown("\n".join(lines))
