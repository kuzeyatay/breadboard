import json
from collections import defaultdict
from pathlib import Path

import pytest

from breadboard_multisim.circuit import Circuit
from breadboard_multisim.schematic import export_project, pin_offsets, project
from breadboard_multisim.tools import dispatch


def assert_connectivity(circuit, scene):
    resolved = circuit.resolved_nodes()
    graph = defaultdict(set)
    occupied = {}
    for wire in scene["wires"]:
        for end, point in [(wire["from"], wire["points"][0]), (wire["to"], wire["points"][-1])]:
            ref, pin = end
            assert resolved[ref][pin - 1] == wire["net"]
            c = next(c for c in circuit.components if c.id == ref)
            dx, dy = pin_offsets(c)[pin - 1]
            assert point == [scene["positions"][ref]["x"] + dx, scene["positions"][ref]["y"] + dy]
        a, b = tuple(wire["from"]), tuple(wire["to"])
        graph[a].add(b)
        graph[b].add(a)
        for a, b in zip(wire["points"], wire["points"][1:]):
            assert a[0] == b[0] or a[1] == b[1]
            # Crossing is permitted, sharing a segment with another net is not.
            dx, dy = (b[0] - a[0]), (b[1] - a[1])
            steps = int(max(abs(dx), abs(dy)) // 12)
            for i in range(steps):
                p = (a[0] + dx * i / steps, a[1] + dy * i / steps)
                q = (a[0] + dx * (i + 1) / steps, a[1] + dy * (i + 1) / steps)
                edge = tuple(sorted((p, q)))
                assert occupied.get(edge, wire["net"]) == wire["net"]
                occupied[edge] = wire["net"]
    nets = defaultdict(set)
    for ref, nodes in resolved.items():
        for i, node in enumerate(nodes):
            nets[node].add((ref, i + 1))
    for net, members in nets.items():
        if net in scene["global_nets"]:
            continue
        found = set()
        pending = [next(iter(members))]
        while pending:
            item = pending.pop()
            if item in found:
                continue
            found.add(item)
            pending.extend(graph[item] - found)
        assert found == members, net
    assert scene["connected"] and not scene["issues"]


@pytest.mark.parametrize(
    "name", ["divider", "rc-filter", "transistor-amplifier", "opamp-amplifier", "mosfet-switch"]
)
def test_examples_export_same_connectivity_and_reopen(service, example, tmp_path, name):
    circuit = Circuit.model_validate(example(name))
    output = tmp_path / "export"
    output.mkdir()
    evidence = output / "circuit.cir"
    evidence.write_text("existing .control evidence", encoding="utf-8")
    data, paths = export_project(circuit, output)
    assert_connectivity(circuit, data["schematic"])
    assert evidence.read_text() == "existing .control evidence"
    assert all(Path(p).is_file() for p in paths)
    html = (output / "schematic.html").read_text(encoding="utf-8")
    assert '<script type="application/json" id="project">' in html
    assert "onclick=" not in html and "<script>" not in html
    assert "Hardware is unverified" in html
    assert data["netlist"] == circuit.netlist()
    restored = dispatch(service, "import_circuit_project", {"project": data})
    assert service.load_circuit(restored["circuit_id"])["circuit"] == circuit.model_dump()
    data["netlist"] += "\n* altered"
    with pytest.raises(ValueError, match="integrity"):
        dispatch(service, "import_circuit_project", {"project": data})


def test_actual_oscillator_is_connected_and_reports_unfinished_control():
    path = Path(__file__).parents[1] / "docs/verification/2026-09-22/circuit.json"
    circuit = Circuit.model_validate(json.loads(path.read_text(encoding="utf-8")))
    data = project(circuit)
    assert_connectivity(circuit, data["schematic"])
    assert len(data["schematic"]["wires"]) == 58
    assert data["review"]["component_counts"]["opamp"] == 12
    assert any("wiper" in w for w in data["review"]["warnings"])
    assert data["review"]["hardware_status"] == "unverified"


def test_connections_ir_and_ground_alias_export_without_inventing_nets():
    circuit = Circuit.model_validate(
        {
            "title": "Explicit connections",
            "components": [
                {"id": "R1", "type": "resistor", "value": "1k"},
                {"id": "R2", "type": "resistor", "value": "1k"},
            ],
            "connections": [["R1.1", "vin"], ["R1.2", "R2.1"], ["R2.2", "GND"]],
        }
    )
    assert_connectivity(circuit, project(circuit)["schematic"])


@pytest.mark.integration
def test_render_failure_does_not_discard_measured_solver_data(real_service, example, monkeypatch):
    from breadboard_multisim import artifacts

    def unavailable(*args):
        raise ValueError("Routing budget exhausted")

    monkeypatch.setattr(artifacts, "schematic", unavailable)
    cid = real_service.create_circuit(example("divider"))["circuit_id"]
    result = real_service.run(cid, {"kind": "op"}, render=True)
    assert result["success"]
    assert "Routing budget" in result["artifact_warnings"][0]
    assert real_service.measure(result["run_id"], {"name": "v", "kind": "voltage", "node": "vout"})[
        "value"
    ] == pytest.approx(2.5)
    assert "Artifact warning" in (Path(result["directory"]) / "report.md").read_text(encoding="utf-8")
