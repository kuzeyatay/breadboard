import hashlib
import json
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

from breadboard_multisim.circuit import Circuit, number
from breadboard_multisim.exports import export_status
from breadboard_multisim.multisim_export_worker import constant_arithmetic
from breadboard_multisim.tools import dispatch

EXAMPLES = ["divider", "rc-filter", "transistor-amplifier", "opamp-amplifier", "mosfet-switch"]


def require_exporter(target):
    if not export_status()[target]["available"]:
        if os.environ.get("BREADBOARD_REQUIRE_NATIVE_EXPORTS") == "1":
            pytest.fail(f"{target} exporter required")
        pytest.skip(f"Set up the {target} exporter to run this integration test")


def check_bundle(result, destination):
    with zipfile.ZipFile(result["bundle_path"]) as archive:
        assert all("/" not in name and "\\" not in name for name in archive.namelist())
        archive.extractall(destination)
    manifest = json.loads((destination / "manifest.json").read_text())
    for name, digest in manifest["files"].items():
        assert hashlib.sha256((destination / name).read_bytes()).hexdigest() == digest
    return manifest


@pytest.mark.parametrize("target", ["ltspice", "multisim"])
@pytest.mark.parametrize("name", EXAMPLES)
def test_real_native_exports_preserve_revisions_models_and_bundle(service, example, tmp_path, target, name):
    require_exporter(target)
    state = service.create_circuit(example(name))
    result = dispatch(service, f"export_{target}", {"circuit_id": state["circuit_id"]})
    manifest = check_bundle(result, tmp_path / "portable")
    assert service.load_circuit(state["circuit_id"]) == state
    assert manifest["circuit_sha256"] == Circuit.model_validate(state["circuit"]).digest()
    assert (tmp_path / "portable/design.cir").read_text() == Circuit.model_validate(state["circuit"]).netlist()
    assert result["verification"]["simulation"] == "not_run"
    if target == "ltspice":
        assert result["verification"]["connectivity"] == "verified"
        schematic = Path(result["schematic_path"]).read_text()
        assert schematic.startswith("Version 4\n")
        assert schematic.count("\nSYMBOL ") == len(state["circuit"]["components"])
    else:
        assert Path(result["schematic_path"]).read_bytes().startswith(b"MSMCompressedElectronicsWorkbenchXML")
        assert result["verification"]["codec_round_trip"] == "verified"
        assert result["verification"]["xml_connectivity"]["status"] == "verified"
        layout = json.loads((tmp_path / "portable/layout-validation.json").read_text())
        assert layout["layout_validation"]["status"] == "pass"
        if name == "opamp-amplifier":
            # The finite-bandwidth, rail-limited model must survive export.
            assert layout["editable_model_coverage"]["status"] == "complete"
            kinds = {c["kind"] for c in layout["components"]}
            assert {"E", "C", "BV"} <= kinds
            assert "OPAMP5" not in kinds
        if name == "divider":
            from multisim_mcp.native_xml import parse_native_xml, write_native_xml
            from multisim_mcp.schematic_builder import parse_netlist

            from breadboard_multisim.multisim_export_worker import validate_xml_connections
            copied_xml = tmp_path / "portable/circuit.ms14.xml"
            tree = parse_native_xml(copied_xml)
            first_port = next(tree.getroot().iter("CiPort"))
            first_port.find("Nodes").clear()
            write_native_xml(tree, copied_xml)
            with pytest.raises(ValueError, match="disconnected pin"):
                validate_xml_connections(copied_xml, parse_netlist(Circuit.model_validate(state["circuit"]).netlist()).components)


def ltspice_executable():
    candidates = [os.environ.get("BREADBOARD_LTSPICE"), shutil.which("LTspice"),
                  str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/ADI/LTspice/LTspice.exe")]
    return next((p for p in candidates if p and Path(p).is_file()), None)


def native_netlist(asc):
    executable = ltspice_executable()
    if not executable:
        pytest.skip("LTspice not installed")
    subprocess.run([executable, "-netlist", str(asc)], check=True, timeout=40,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    raw = asc.with_suffix(".net").read_bytes()
    if raw.startswith(b"\xff\xfe"):
        text = raw.decode("utf-16")
    else:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("cp1252")
    records = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith(("*", ".")):
            continue
        tokens = line.split(";", 1)[0].split()
        ref = tokens[0].split("§")[-1].lower()
        records[ref] = tokens[1:]
    return records, text


@pytest.mark.parametrize("name", EXAMPLES)
def test_ltspice_itself_reads_portable_files_with_expected_pins_and_values(service, example, tmp_path, name):
    require_exporter("ltspice")
    if not ltspice_executable():
        pytest.skip("LTspice not installed")
    state = service.create_circuit(example(name))
    result = dispatch(service, "export_ltspice", {"circuit_id": state["circuit_id"], "analysis": {"kind": "op"}})
    portable = tmp_path / "moved project with spaces"
    check_bundle(result, portable)
    records, text = native_netlist(portable / "circuit.asc")
    circuit = Circuit.model_validate(state["circuit"])
    assert set(records) == {c.id.lower() for c in circuit.components}
    for c in circuit.components:
        actual = records[c.id.lower()]
        assert [n.lower() for n in actual[:c.pins]] == circuit.resolved_nodes()[c.id]
        if c.type in {"resistor", "capacitor", "inductor"}:
            assert number(actual[c.pins].replace("µ", "u")) == number(c.value)
        if c.model:
            assert c.model.lower() in [t.lower() for t in actual[c.pins:]]
        for key, value in c.parameters.items():
            assert f"{key}={value}".lower() in " ".join(actual).lower()
        if c.ac is not None:
            index = [t.lower() for t in actual].index("ac")
            assert float(actual[index + 1]) == c.ac
    assert ".op" in text
    assert not (portable / "circuit.log").exists()


@pytest.mark.parametrize("pins", [2, 4, 5, 16, 64])
def test_custom_ic_symbols_preserve_pin_count_and_model(service, tmp_path, pins):
    require_exporter("ltspice")
    nodes = ["input"] + [f"out{i}" for i in range(1, pins - 1)] + ["0"]
    circuit = {"components": [
        {"id": "V1", "type": "voltage_source", "value": 1, "nodes": ["input", "0"]},
        {"id": "X1", "type": "ic", "pin_count": pins, "model": "CUSTOM", "nodes": nodes}],
        "models": [{"name": "CUSTOM", "provenance": "test fixture", "definition":
                    ".subckt CUSTOM " + " ".join(f"p{i}" for i in range(pins)) + "\n" +
                    "\n".join(f"R{i} p{i} p{pins-1} 1k" for i in range(pins - 1)) + "\n.ends CUSTOM"}]}
    state = service.create_circuit(circuit)
    result = service.export_native_circuit(state["circuit_id"], "ltspice")
    portable = tmp_path / "custom portable"
    check_bundle(result, portable)
    symbols = list(portable.glob("*.asy"))
    assert len(symbols) == 1
    assert symbols[0].read_text().count("PINATTR SpiceOrder") == pins
    if ltspice_executable():
        records, _ = native_netlist(portable / "circuit.asc")
        assert [n.lower() for n in records["x1"][:pins]] == nodes
        assert records["x1"][pins] == "CUSTOM"


def test_export_failure_publishes_nothing_and_does_not_change_circuit(service, example, monkeypatch):
    from breadboard_multisim import exports
    state = service.create_circuit(example("divider"))
    monkeypatch.setattr(exports, "export_status", lambda: {"ltspice": {"available": True}})
    def fail(*args, **kwargs):
        raise RuntimeError("routing failed")
    monkeypatch.setattr(exports, "run_process", fail)
    parent = service.path("circuits", state["circuit_id"])
    before = set(parent.iterdir())
    with pytest.raises(RuntimeError, match="routing failed"):
        service.export_native_circuit(state["circuit_id"], "ltspice")
    assert set(parent.iterdir()) == before
    assert service.load_circuit(state["circuit_id"]) == state


def test_unavailable_multisim_is_actionable(service, example, monkeypatch):
    from breadboard_multisim import exports
    state = service.create_circuit(example("divider"))
    monkeypatch.setattr(exports, "export_status", lambda: {"multisim": {"available": False, "setup": "Provision local templates"}})
    with pytest.raises(RuntimeError, match="Provision local templates"):
        dispatch(service, "export_multisim", {"circuit_id": state["circuit_id"]})


def test_constant_model_parameters_are_bounded_and_do_not_execute():
    assert float(constant_arithmetic("{100000/(6.283185307179586*10000000*1000)}")) == pytest.approx(1.5915494309189534e-6)
    for expression in ["{__import__('os').system('anything')}", "{2**100000000}", "{1/0}", "{V(out)}"]:
        assert constant_arithmetic(expression) == expression


@pytest.mark.parametrize("change", ["temperature", "parameters"])
def test_multisim_rejects_fields_the_builder_would_drop(service, example, change):
    circuit = example("divider")
    if change == "temperature":
        circuit["temperature"] = 85
    else:
        next(c for c in circuit["components"] if c["type"] == "resistor")["parameters"] = {"tc1": 0.001}
    state = service.create_circuit(circuit)
    with pytest.raises(ValueError, match="temperature|parameters"):
        service.export_native_circuit(state["circuit_id"], "multisim")
