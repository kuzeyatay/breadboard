import math
from pathlib import Path

import numpy as np
import pytest

from breadboard_multisim.measurements import Signals
from breadboard_multisim.optimization import (
    apply_optimized_values,
    monte_carlo_analysis,
    optimize_values,
    parameter_sweep,
)
from breadboard_multisim.service import read_json
from breadboard_multisim.tools import dispatch

pytestmark = pytest.mark.integration


def run(service, example, name, analysis, **kwargs):
    state = service.create_circuit(example(name))
    result = service.run(state["circuit_id"], analysis, render=False, **kwargs)
    assert result["success"], result
    return state, result


def value(service, result, kind, **kwargs):
    evidence = service.measure(result["run_id"], {"name": kind, "kind": kind, **kwargs})
    assert evidence["status"] == "measured", evidence
    return evidence["value"]


def test_divider_netlist_op_dc_and_power(real_service, example):
    state, result = run(real_service, example, "divider", {"kind": "op"})
    netlist = real_service.export_netlist(state["circuit_id"])["netlist"]
    assert "R1 vin vout 10k" in netlist
    assert value(real_service, result, "voltage", node="vout") == pytest.approx(2.5, rel=1e-7)
    assert value(real_service, result, "current", component="R1") == pytest.approx(0.00025, rel=1e-7)
    assert value(real_service, result, "current", component="V1") == pytest.approx(-0.00025, rel=1e-7)
    assert value(real_service, result, "power", component="R2") == pytest.approx(0.000625, rel=1e-7)
    assert value(real_service, result, "power", component="V1") == pytest.approx(-0.00125, rel=1e-7)
    dc = real_service.run(
        state["circuit_id"], {"kind": "dc", "source": "V1", "start": 0, "stop": 10, "step": 1}, render=False
    )
    assert dc["success"], dc
    raw = read_json(Path(dc["directory"]) / "data.json")
    sig = Signals(raw, "dc")
    np.testing.assert_allclose(sig.voltage("vout"), np.arange(11) / 2, atol=1e-9)


def test_polynomial_sources_used_by_manufacturer_opamp_models(real_service):
    """An executable-only Windows install passes R/C tests but cannot load POLY."""
    state = real_service.create_circuit({
        "components": [
            {"id": "VIN", "type": "voltage_source", "value": 1.25, "nodes": ["vin", "0"]},
            {"id": "XAMP", "type": "ic", "model": "POLY_STAGE", "pin_count": 2,
             "nodes": ["vin", "vout"]},
            {"id": "RL", "type": "resistor", "value": "10k", "nodes": ["vout", "0"]},
        ],
        "models": [{
            "name": "POLY_STAGE",
            "definition": ".subckt POLY_STAGE vin out\nEout out 0 POLY(1) vin 0 0 2\n.ends POLY_STAGE",
            "provenance": "Synthetic polynomial source fixture exercising XSPICE loading",
        }],
    })
    result = real_service.run(state["circuit_id"], {"kind": "op"}, render=False)
    assert result["success"], result.get("diagnostics")
    assert value(real_service, result, "voltage", node="vout") == pytest.approx(2.5, rel=1e-8)


def test_rc_response_transient_and_johnson_noise(real_service, example):
    state, result = run(
        real_service, example, "rc-filter", {"kind": "ac", "start": 1, "stop": 1e5, "points": 100}
    )
    cutoff = 1 / (2 * math.pi * 1000 * 1e-6)
    assert value(
        real_service, result, "gain", node="vout", input_node="vin", frequency=cutoff
    ) == pytest.approx(-3.0103, abs=0.004)
    assert value(real_service, result, "bandwidth", node="vout", input_node="vin") == pytest.approx(
        cutoff, rel=0.002
    )
    tran = real_service.run(
        state["circuit_id"], {"kind": "tran", "start": 0, "stop": 0.006, "step": 1e-5}, render=False
    )
    assert tran["success"], tran
    raw = read_json(Path(tran["directory"]) / "data.json")
    sig = Signals(raw, "tran")
    assert np.interp(0.001001, sig.axis, sig.voltage("vout")) == pytest.approx(1 - math.exp(-1), abs=0.001)
    noise = real_service.run(
        state["circuit_id"],
        {"kind": "noise", "source": "V1", "output": "vout", "start": 1, "stop": 1e5},
        render=False,
    )
    assert noise["success"], noise
    expected = math.sqrt(4 * 1.380649e-23 * 300.15 * 1000) / math.sqrt(1 + (10 / cutoff) ** 2)
    assert value(real_service, noise, "noise", frequency=10) == pytest.approx(expected, rel=0.01)


def test_bjt_bias_gain_and_collector_current(real_service, example):
    state, result = run(real_service, example, "transistor-amplifier", {"kind": "op"})
    vc = value(real_service, result, "voltage", node="vout")
    ve = value(real_service, result, "voltage", node="emitter")
    assert 1 < ve < 2 and 6 < vc < 9
    assert value(real_service, result, "current", component="Q1") == pytest.approx(
        (12 - vc) / 3300, rel=0.001
    )
    ac = real_service.run(state["circuit_id"], {"kind": "ac", "start": 10, "stop": 1e6}, render=False)
    assert ac["success"], ac
    gain = real_service.measure(
        ac["run_id"], {"kind": "gain", "name": "gain", "node": "vout", "input_node": "vin", "frequency": 1000}
    )
    assert 2.8 < gain["linear"] < 3.5 and abs(gain["phase_deg"]) > 170


def test_opamp_gain_bandwidth_and_bias(real_service, example):
    state, result = run(real_service, example, "opamp-amplifier", {"kind": "op"})
    assert value(real_service, result, "voltage", node="vout") == pytest.approx(1, rel=0.001)
    ac = real_service.run(state["circuit_id"], {"kind": "ac", "start": 10, "stop": 1e8}, render=False)
    assert ac["success"], ac
    assert value(real_service, ac, "gain", node="vout", input_node="vin", frequency=1000) == pytest.approx(
        20, abs=0.005
    )
    assert value(real_service, ac, "bandwidth", node="vout", input_node="vin") == pytest.approx(
        1e6, rel=0.003
    )
    pm = real_service.measure(
        ac["run_id"], {"kind": "phase_margin", "name": "pm", "node": "vout", "input_node": "vin"}
    )
    assert pm["status"] == "unverified"


def test_mosfet_switch(real_service, example):
    _, result = run(
        real_service, example, "mosfet-switch", {"kind": "tran", "start": 0, "stop": 20e-6, "step": 20e-9}
    )
    raw = read_json(Path(result["directory"]) / "data.json")
    sig = Signals(raw, "tran")
    assert np.interp(0.5e-6, sig.axis, sig.voltage("vout")) == pytest.approx(5, abs=1e-5)
    assert np.interp(3e-6, sig.axis, sig.voltage("vout")) < 0.03
    assert np.interp(7e-6, sig.axis, sig.voltage("vout")) > 4.99


def test_sweep_monte_carlo_and_optimization(real_service, example):
    state = real_service.create_circuit(example("divider"))
    cid = state["circuit_id"]
    voltage = {"kind": "voltage", "name": "vout", "node": "vout"}
    sweep = parameter_sweep(real_service, cid, {"kind": "op"}, {"R2.value": [10000, 20000, 30000]}, [voltage])
    assert [r["measurements"][0]["value"] for r in sweep["rows"]] == pytest.approx([2.5, 10 / 3, 3.75])
    mc1 = monte_carlo_analysis(real_service, cid, {"kind": "op"}, samples=4, seed=42, measurements=[voltage])
    mc2 = monte_carlo_analysis(real_service, cid, {"kind": "op"}, samples=4, seed=42, measurements=[voltage])
    assert [r["parameters"] for r in mc1["rows"]] == [r["parameters"] for r in mc2["rows"]]
    optimized = optimize_values(
        real_service,
        cid,
        {"kind": "op"},
        [{"component": "R2", "minimum": 10000, "maximum": 30000, "scale": "linear"}],
        [{"measurement": voltage, "target": 3.3, "scale": 0.1}],
        max_evaluations=24,
    )
    assert optimized["success"], optimized
    assert optimized["objective_loss"] < 0.1
    assert real_service.load_circuit(cid) == state
    applied = apply_optimized_values(real_service, optimized["study_id"], 1)
    assert applied["revision"] == 2
    with pytest.raises(ValueError, match="Revision conflict"):
        apply_optimized_values(real_service, optimized["study_id"], 1)


def test_artifact_integrity_and_tool_path(real_service, example):
    state = dispatch(real_service, "create_circuit", {"circuit": example("rc-filter")})
    result = dispatch(
        real_service,
        "run_circuit_experiment",
        {
            "circuit_id": state["circuit_id"],
            "analysis": {"kind": "ac", "start": 1, "stop": 1e5},
            "measurements": [
                {"kind": "gain", "name": "gain", "node": "vout", "input_node": "vin", "frequency": 100}
            ],
        },
    )
    assert result["success"], result
    directory = Path(result["directory"])
    for name in (
        "schematic.svg",
        "schematic.png",
        "bode.svg",
        "bode.png",
        "data.csv",
        "result.raw",
        "report.md",
        "manifest.json",
    ):
        assert (directory / name).stat().st_size > 20
    assert real_service.inspect_artifacts(result["run_id"])["integrity_ok"]
    (directory / "data.csv").write_text("changed", encoding="utf-8")
    assert not real_service.inspect_artifacts(result["run_id"])["integrity_ok"]
