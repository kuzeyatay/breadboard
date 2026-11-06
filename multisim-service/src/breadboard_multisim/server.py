"""MCP stdio transport over the same contracts used by Breadboard's native agent."""

from __future__ import annotations

import asyncio
import functools

from mcp.server.mcpserver import MCPServer

from .service import service_for
from .tools import CONTRACTS, Tools

MODES = {
    "design_circuit": "Translate requirements into explicit assumptions and constraints. Select a topology; build the editable IR with model provenance; validate the netlist. Check OP, then AC/noise/transient as relevant. Verify constraints before claiming success.",
    "simulate_circuit": "Check runtime_status, validate export_netlist, then run_circuit_experiment with declared measurements and constraints. Read diagnostics, raw evidence and artifact integrity.",
    "debug_circuit": "Inspect retained logs and bias point. Distinguish missing evidence from failed constraints. Form a falsifiable hypothesis, change one parameter in a new revision, rerun and compare.",
    "optimize_circuit": "Measure a baseline, declare bounded variables, objective scales, hard constraints and evaluation budget. Run optimize_values. Inspect the fresh final verification before applying the candidate with expected_revision.",
    "write_lab_report": "Use retained circuit, stimulus, models, raw data and manifest. State units, assumptions and pass/fail/unverified requirements. Link schematic, waveform, CSV and report artifacts. Do not infer real-device noise or stability from an ideal model.",
}


def create_server(workspace, backend="ngspice"):
    service = service_for(workspace, backend)
    api = Tools(service)
    server = MCPServer("breadboard-multisim", instructions=MODES["design_circuit"])

    def threaded(function):
        @functools.wraps(function)
        async def invoke(**kwargs):
            return await asyncio.to_thread(function, **kwargs)

        return invoke

    for name in CONTRACTS:
        server.add_tool(threaded(getattr(api, name)), name=name)

    @server.resource("breadboard-multisim://runs/{run_id}/summary", mime_type="application/json")
    def run_summary(run_id: str) -> dict:
        return service.get_run(run_id)

    def workflow(instructions):
        def prompt(requirements: str = "") -> str:
            return instructions + "\n" + requirements

        return prompt

    for name, instructions in MODES.items():
        server.prompt(name=name, description=instructions)(workflow(instructions))
    return server


def serve(workspace, backend="ngspice"):
    create_server(workspace, backend).run(transport="stdio")
