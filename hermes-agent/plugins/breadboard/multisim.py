"""Service-gated circuit tools; simulator dependencies stay in their own runtime."""
from __future__ import annotations

import json
from pathlib import Path


def runtime_config():
    root = Path(__file__).resolve().parents[3]
    config = root / ".runtime/multisim.json"
    if not config.is_file():
        return None
    try:
        value = json.loads(config.read_text(encoding="utf-8"))
        return value if Path(value["python"]).is_file() else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def available():
    return runtime_config() is not None


SCHEMA = {
    "name": "multisim",
    "description": "Design, edit, simulate, measure, verify and optimize electronic circuits with Breadboard's Multisim Agent. Start with runtime_status, then describe_tool for an operation's typed schema. Read the multisim-agent skill. The open-source ngspice engine needs no NI license. All circuit/run IDs are scoped to this conversation.",
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "description": "Native tool name: runtime_status, describe_tool, read_reference, create_circuit, load_circuit, add_component, remove_component, modify_component, connect_components, disconnect_components, add_model, export_netlist, run_operating_point, run_dc_sweep, run_ac_analysis, run_transient_analysis, run_noise_analysis, run_circuit_experiment, measure_voltage, measure_current, measure_power, measure_frequency, measure_distortion, measure_gain, measure_bandwidth, measure_phase_margin, measure_noise, verify_constraints, parameter_sweep, monte_carlo_analysis, optimize_values, apply_optimized_values, render_schematic, plot_results, get_run, list_runs, cancel_run, get_study, cancel_study, inspect_artifacts"},
            "arguments": {"type": "object", "description": "Arguments for the chosen operation. describe_tool takes name; create_circuit takes circuit JSON or title."},
        },
        "required": ["action"],
        "additionalProperties": False,
    },
}


def register_tools(ctx, broker):
    from functools import partial
    ctx.register_tool(name="multisim", toolset="breadboard", schema=SCHEMA,
                      handler=partial(broker, tool_name="multisim", route="/api/hermes/tools/multisim", route_kind="multisim"),
                      check_fn=available, emoji="")

