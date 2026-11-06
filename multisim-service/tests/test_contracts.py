import json
import sys
from pathlib import Path

import numpy as np
import pytest
from mcp import Client
from mcp.client.stdio import StdioServerParameters

from breadboard_multisim.backends import Analysis, NgspiceBackend, parse_output
from breadboard_multisim.circuit import Circuit, Component, Model, number
from breadboard_multisim.measurements import Constraint, Measurement, measure, verify
from breadboard_multisim.optimization import parameter_sweep
from breadboard_multisim.service import read_json
from breadboard_multisim.tools import CONTRACTS, dispatch


@pytest.mark.parametrize(
    "name",
    [
        "design",
        "simulate",
        "debug",
        "optimize",
        "divider",
        "rc-filter",
        "transistor-amplifier",
        "opamp-amplifier",
        "mosfet-switch",
    ],
)
def test_chat_references_are_shipped_and_match_the_skill(service, name):
    result = dispatch(service, "read_reference", {"name": name})
    suffix = ".md" if result["format"] == "markdown" else ".json"
    directory = "workflows" if suffix == ".md" else "examples"
    root = Path(__file__).resolve().parents[2]
    for skill in ["skills/multisim-agent", "hermes-skills/prebuilt/multisim-agent"]:
        assert result["content"] == (root / skill / directory / (name + suffix)).read_text(encoding="utf-8")
    if suffix == ".json":
        Circuit.model_validate(json.loads(result["content"])).netlist()


def test_reference_tool_cannot_read_arbitrary_paths(service):
    with pytest.raises(ValueError):
        dispatch(service, "read_reference", {"name": "../../private"})


@pytest.mark.parametrize(
    "value,expected", [("10k", 10000), ("1M", 0.001), ("1meg", 1e6), ("1u", 1e-6), ("2.2e-9", 2.2e-9)]
)
def test_spice_scales(value, expected):
    assert number(value) == expected


@pytest.mark.parametrize("value", [True, "1k\n.end", "inf", "nan", "1; shell evil", "1KOhm"])
def test_invalid_values(value):
    with pytest.raises(ValueError):
        number(value)


def test_edit_revisions_connections_and_invalid_rollback(service):
    state = service.create_circuit(title="Connected IR")
    cid = state["circuit_id"]
    service.add_component(cid, {"id": "V1", "type": "voltage_source", "value": 5})
    service.add_component(cid, {"id": "R1", "type": "resistor", "value": "1k"})
    service.connect_components(cid, "V1.1", "VIN")
    service.connect_components(cid, "V1.2", "GND")
    service.connect_components(cid, "R1.1", "vin")
    state = service.connect_components(cid, "R1.2", "0")
    assert "R1 vin 0 1k" in service.export_netlist(cid)["netlist"]
    for changes in ({"value": -1}, {"id": "R2"}, {"parameters": {"bad\n.shell": 1}}):
        with pytest.raises(ValueError):
            service.modify_component(cid, "R1", changes)
        assert service.load_circuit(cid) == state
    with pytest.raises(ValueError, match="Revision conflict"):
        service.modify_component(cid, "R1", {"value": 2e3}, 1)
    with pytest.raises(ValueError, match="shorts distinct nets"):
        service.connect_components(cid, "vin", "0")
    with pytest.raises(ValueError, match="Unknown pin"):
        service.connect_components(cid, "R1.3", "0")
    state = service.remove_component(cid, "R1")
    assert all("R1" not in endpoint for edge in state["circuit"]["connections"] for endpoint in edge)


@pytest.mark.parametrize("path", ["../secrets", "/etc/passwd", "x" * 32, "a/../../b"])
def test_object_id_containment(service, path):
    with pytest.raises(ValueError):
        service.load_circuit(path)


@pytest.mark.parametrize(
    "definition",
    [
        ".model D1 D\n.control\nshell whoami\n.endc",
        ".model D1 D\n.include secret",
        ".model D1 D\n.end\nR1 0 hidden 1",
    ],
)
def test_model_command_injection(definition):
    with pytest.raises(ValueError):
        Model(name="D1", definition=definition, provenance="test")


def test_all_required_device_netlists(example):
    for name in ["divider", "rc-filter", "transistor-amplifier", "opamp-amplifier", "mosfet-switch"]:
        text = Circuit.model_validate(example(name)).netlist()
        assert text.endswith(".end\n")
    circuit = Circuit(
        components=[
            Component(id="V1", type="voltage_source", nodes=["vin", "0"], value=1),
            Component(id="L1", type="inductor", nodes=["vin", "mid"], value="1m"),
            Component(id="D1", type="diode", nodes=["mid", "0"], model="DIODE"),
            Component(id="I1", type="current_source", nodes=["0", "mid"], value="1m"),
            Component(id="X1", type="ic", nodes=["mid", "0"], pin_count=2, model="LOAD"),
        ],
        models=[
            Model(name="DIODE", definition=".model DIODE D(IS=1e-14)", provenance="test"),
            Model(name="LOAD", definition=".subckt LOAD p n\nRload p n 1k\n.ends LOAD", provenance="test"),
        ],
    )
    assert "X1 mid 0 LOAD" in circuit.netlist()
    circuit.models.pop()
    with pytest.raises(ValueError, match="Missing inline model"):
        circuit.netlist()


@pytest.mark.parametrize(
    "analysis",
    [
        {"kind": "ac", "start": 0},
        {"kind": "dc", "start": 0, "stop": 5, "step": -1},
        {"kind": "tran", "start": 0, "stop": 1, "step": 1e-12},
        {"kind": "op", "timeout": float("nan")},
    ],
)
def test_invalid_analysis_budget(analysis):
    with pytest.raises(ValueError):
        Analysis.model_validate(analysis)


def synthetic_raw(axis, vectors):
    columns = {"frequency": axis, **vectors}
    matrix = np.array(list(columns.values()), dtype=complex).T
    return {
        "variables": [{"name": name} for name in columns],
        "rows": np.abs(matrix).tolist(),
        "real_rows": matrix.real.tolist(),
        "imaginary_rows": matrix.imag.tolist(),
    }


def test_phase_margin_and_missing_crossings():
    f = np.geomspace(1, 1e7, 701)
    h = 1000 / (1 + 1j * f / 1000)
    raw = synthetic_raw(f, {"v(vin)": np.ones(len(f)), "v(vout)": h})
    circuit = Circuit()
    evidence = measure(
        circuit, raw, {"kind": "ac"}, Measurement(name="pm", kind="phase_margin", loop_gain=True)
    )
    assert evidence["value"] == pytest.approx(90.0573, abs=0.001)
    missing = measure(circuit, raw, {"kind": "ac"}, Measurement(name="gain", kind="gain", frequency=1e10))
    assert missing["status"] == "unverified"
    missing_node = verify(
        circuit,
        raw,
        {"kind": "ac"},
        [
            Constraint(
                measurement=Measurement(name="gain", kind="gain", node="absent", frequency=10), minimum=1
            )
        ],
    )
    assert missing_node["verdict"] == "unverified"
    flat = synthetic_raw(f, {"v(vin)": np.ones(len(f)), "v(vout)": np.ones(len(f))})
    assert (
        measure(circuit, flat, {"kind": "ac"}, Measurement(name="bw", kind="bandwidth"))["status"]
        == "unverified"
    )


def test_adaptive_time_weighted_rms_and_mean(example):
    time = [0, 0.01, 0.1, 1]
    raw = {"variables": [{"name": "time"}, {"name": "v(vout)"}], "rows": [[t, t] for t in time]}
    result = measure(
        Circuit.model_validate(example("divider")),
        raw,
        {"kind": "tran"},
        Measurement(name="average", kind="voltage"),
    )
    assert result["value"] == pytest.approx(0.5)


def test_corrupt_partial_raw_rejected(tmp_path):
    path = tmp_path / "result.raw"
    path.write_text(
        "Title: partial\nPlotname: Transient Analysis\nFlags: real\nNo. Variables: 2\nNo. Points: 2\nVariables:\n0 time time\n1 v(out) voltage\nValues:\n0 0\n0\n"
    )
    with pytest.raises(ValueError, match="point count mismatch"):
        parse_output(path, Analysis(kind="tran", start=0, stop=1, step=0.1))


def test_missing_backend_retains_failure(service, example):
    service.backend = NgspiceBackend("nonexistent-ngspice-executable")
    cid = service.create_circuit(example("divider"))["circuit_id"]
    result = service.run(cid, {"kind": "op"}, render=False)
    assert not result["success"] and result["status"] == "failed"
    assert (Path(result["directory"]) / "report.md").is_file()
    with pytest.raises(ValueError, match="Failed run"):
        service.measure(result["run_id"], {"name": "voltage", "kind": "voltage"})


def test_budget_checked_before_simulation(service, example):
    cid = service.create_circuit(example("divider"))["circuit_id"]
    with pytest.raises(ValueError, match="100"):
        parameter_sweep(service, cid, {"kind": "op"}, {"R1.value": list(range(1, 102))})
    assert service.list_runs() == []


def test_invalid_sweep_retains_terminal_failure(service, example):
    cid = service.create_circuit(example("divider"))["circuit_id"]
    with pytest.raises(ValueError, match="Unknown component"):
        parameter_sweep(service, cid, {"kind": "op"}, {"Rmissing.value": [1]})
    summaries = list((service.root / "studies").glob("*/summary.json"))
    assert len(summaries) == 1
    assert read_json(summaries[0])["status"] == "failed"
    assert service.list_runs() == []


def test_large_schematic_keeps_one_connected_project_with_all_ic_pins(service):
    from PIL import Image

    circuit = {
        "title": "Large circuit",
        "components": [
            {"id": f"R{i}", "type": "resistor", "value": "1k", "nodes": [f"n{i}", "0"]} for i in range(25)
        ]
        + [
            {
                "id": "X1",
                "type": "ic",
                "model": "TEST64",
                "pin_count": 64,
                "nodes": [f"pin{i}" for i in range(64)],
            }
        ],
        "models": [
            {
                "name": "TEST64",
                "provenance": "Synthetic pin rendering regression fixture",
                "definition": ".subckt TEST64 "
                + " ".join(f"pin{i}" for i in range(64))
                + "\nRinternal pin0 pin63 1meg\n.ends TEST64",
            }
        ],
    }
    cid = service.create_circuit(circuit)["circuit_id"]
    result = service.render_schematic(cid)
    paths = result["paths"]
    images = [path for path in paths if path.endswith(".png")]
    assert len(images) == 1
    assert result["connected"]
    for path in images:
        with Image.open(path) as bitmap:
            assert max(bitmap.size) < 4000
    assert "pin63" in Path(result["view_path"]).read_text(encoding="utf-8")
    assert len(read_json(result["project_path"])["circuit"]["components"]) == 26


def test_native_tool_schema_dispatch(service):
    required = {
        "create_circuit",
        "add_component",
        "remove_component",
        "connect_components",
        "modify_component",
        "load_circuit",
        "run_operating_point",
        "run_dc_sweep",
        "run_ac_analysis",
        "run_transient_analysis",
        "run_noise_analysis",
        "measure_voltage",
        "measure_current",
        "measure_power",
        "measure_gain",
        "measure_bandwidth",
        "measure_phase_margin",
        "parameter_sweep",
        "monte_carlo_analysis",
        "optimize_values",
        "verify_constraints",
        "export_circuit_project",
        "import_circuit_project",
    }
    assert required <= set(CONTRACTS)
    with pytest.raises(ValueError):
        dispatch(service, "runtime_status", {"extra": "not silently accepted"})
    assert dispatch(service, "describe_tool", {"name": "add_component"})["inputSchema"]["$defs"]["Component"]


@pytest.mark.parametrize("mode", ["2026-07-28", "legacy"])
@pytest.mark.asyncio
async def test_mcp_stdio_round_trip(tmp_path, example, mode):
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "breadboard_multisim", "--workspace", str(tmp_path), "serve"]
    )
    async with Client(params, mode=mode) as client:
        listed = await client.list_tools()
        assert {t.name for t in listed.tools} == set(CONTRACTS)
        prompts = await client.list_prompts()
        assert any(p.name == "debug_circuit" for p in prompts.prompts)
        prompt = await client.get_prompt("design_circuit", {"requirements": "20 dB amplifier"})
        assert "20 dB amplifier" in prompt.messages[0].content.text
        created = await client.call_tool("create_circuit", {"circuit": example("divider")})
        assert not created.is_error, created
        state = json.loads(created.content[0].text)
        loaded = await client.call_tool("load_circuit", {"circuit_id": state["circuit_id"]})
        assert json.loads(loaded.content[0].text) == state
        invalid = await client.call_tool(
            "modify_component",
            {"circuit_id": state["circuit_id"], "component_id": "R1", "changes": {"value": -1}},
        )
        assert invalid.is_error


@pytest.mark.asyncio
async def test_upstream_compatibility_surface(tmp_path):
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "breadboard_multisim", "--workspace", str(tmp_path), "upstream"]
    )
    async with Client(params, mode="legacy") as client:
        listed = await client.list_tools()
        assert {
            "run_circuit_experiment",
            "submit_circuit_experiment",
            "retry_experiment_job",
            "runtime_status",
        } <= {t.name for t in listed.tools}
        assert (await client.list_resource_templates()).resource_templates
        assert (await client.list_prompts()).prompts
