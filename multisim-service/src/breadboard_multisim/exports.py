"""Native EDA exports, isolated from simulator runs and published only after checks."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path

from .backends import Analysis
from .circuit import OPAMP, PREFIX, Circuit

RUNTIME = Path(__file__).with_name("export_runtime")
ROOT = Path(__file__).resolve().parents[3]


def export_config() -> dict:
    path = Path(os.environ.get("BREADBOARD_CIRCUIT_EXPORT_CONFIG", ROOT / ".runtime/multisim-exports.json"))
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def export_status() -> dict:
    config = export_config()
    node = shutil.which(config.get("node") or "node")
    dependencies = RUNTIME / "node_modules"
    weave = bool(node and (dependencies / "elkjs/package.json").is_file())
    codec = bool(node and (dependencies / "electronics-workbench-decoder/package.json").is_file())
    pack = os.environ.get("MULTISIM_MCP_TEMPLATE_DIR") or config.get("multisim_template_dir")
    templates = bool(pack and (Path(pack) / "minimal.ms14.xml").is_file())
    return {
        "ltspice": {"available": weave, "format": ".asc", "engine": "weave",
                    "setup": None if weave else "Run npm run setup:multisim (installs pinned Node exporters)."},
        "multisim": {"available": codec and templates, "format": ".ms14", "engine": "multisim-mcp",
                     "codec_available": codec, "templates_available": templates,
                     "setup": None if codec and templates else
                     "Run node scripts/setup-multisim-exports.mjs; for local NI templates use --multisim-python <32-bit python>."},
    }


def run_process(command, *, payload=None, env=None, timeout=120):
    try:
        result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                                capture_output=True, text=True, encoding="utf-8", errors="replace",
                                env=env, timeout=timeout, check=False,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Circuit exporter exceeded {timeout} seconds; no export published") from exc
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "Circuit exporter failed")[-6000:])
    return result.stdout


def ltspice_payload(circuit: Circuit, analysis: Analysis | None):
    nodes = circuit.resolved_nodes()
    components = []
    models = list(circuit.models)
    if any(c.type == "opamp" and not c.model for c in circuit.components):
        models.append(OPAMP)
    definitions = {m.name.lower(): m.definition for m in models}
    for c in circuit.components:
        polarity = None
        if c.type in {"bjt", "mosfet"}:
            match = re.search(r"(?im)^\s*\.model\s+\S+\s+(npn|pnp|nmos|pmos)\b", definitions[c.model.lower()])
            allowed = {"npn", "pnp"} if c.type == "bjt" else {"nmos", "pmos"}
            if not match or match[1].lower() not in allowed:
                raise ValueError(f"Cannot select an LTspice symbol for {c.id}: explicit device polarity required")
            polarity = match[1].lower()
        if c.type in {"voltage_source", "current_source"}:
            value = f"DC {c.value}" + (f" {c.waveform}" if c.waveform else "")
        elif c.type in {"resistor", "capacitor", "inductor"}:
            value = str(c.value)
        else:
            value = c.model or OPAMP.name
        components.append({"id": c.id, "type": c.type, "nodes": nodes[c.id], "value": value,
                           "prefix": PREFIX[c.type], "polarity": polarity, "ac": c.ac,
                           "ac_phase": c.ac_phase,
                           "parameters": " ".join(f"{k}={v}" for k, v in sorted(c.parameters.items()))})
    directives = [f".temp {circuit.temperature:g}"]
    if models:
        directives.append('.include "models.lib"')
    if analysis:
        directives.append("." + analysis.command(circuit))
    return {"components": components, "directives": directives}, models


def export_circuit(circuit: Circuit, parent: Path, revision: int, target: str, analysis: Analysis | None = None):
    if target not in {"ltspice", "multisim"}:
        raise ValueError("Export format must be ltspice or multisim")
    netlist = circuit.netlist()
    if target == "multisim":
        if circuit.temperature != 27:
            raise ValueError("Multisim export currently requires 27 C; the builder cannot preserve a custom simulation temperature")
        unsupported = [c.id for c in circuit.components
                       if c.parameters and c.type not in {"diode", "bjt", "mosfet", "ic", "opamp"}]
        if unsupported:
            raise ValueError("Multisim cannot preserve instance parameters for: " + ", ".join(unsupported))
    if len(circuit.components) > 200 or sum(c.pins for c in circuit.components) > 1200:
        raise ValueError("Native schematic export supports up to 200 components / 1200 pins")
    status = export_status()[target]
    if not status["available"]:
        raise RuntimeError(f"{target} exporter unavailable. {status['setup']}")
    config = export_config()
    node = config.get("node") or shutil.which("node")
    destination = parent / f"{target}-{revision}-{uuid.uuid4().hex[:12]}"
    with tempfile.TemporaryDirectory(prefix=".export-", dir=parent) as temporary:
        directory = Path(temporary)
        (directory / "design.cir").write_text(netlist, encoding="utf-8")
        (directory / "design.json").write_text(circuit.model_dump_json(indent=2), encoding="utf-8")
        warnings = []
        if target == "ltspice":
            payload, models = ltspice_payload(circuit, analysis)
            if models:
                (directory / "models.lib").write_text("\n\n".join(m.definition for m in models) + "\n", encoding="utf-8")
            details = json.loads(run_process([node, str(RUNTIME / "export.cjs"), target, str(directory)],
                                             payload=payload, timeout=180))
            verification = {"connectivity": details["connectivity"], "application_open": "not_run",
                            "simulation": "not_run"}
        else:
            env = {**os.environ, "MULTISIM_MCP_TEMPLATE_DIR":
                   os.environ.get("MULTISIM_MCP_TEMPLATE_DIR") or config["multisim_template_dir"],
                   "MULTISIM_MCP_TEMPLATE_ONLY": "true"}
            build = json.loads(run_process([sys.executable, "-m", "breadboard_multisim.multisim_export_worker",
                                           str(directory)], payload={"netlist": netlist}, env=env))
            (directory / "layout-validation.json").write_text(json.dumps(build, indent=2), encoding="utf-8")
            details = json.loads(run_process([node, str(RUNTIME / "export.cjs"), target, str(directory)], payload={}))
            warnings.extend(build.get("model_warnings", []))
            if config.get("multisim_template_source") == "installed_sample":
                warnings.append("Project shell uses the installed NI sample schema; native application compatibility is unverified.")
            warnings.append("Multisim application opening and simulation were not run by this export.")
            verification = {"codec_round_trip": details["codec_round_trip"],
                            "xml_connectivity": build["xml_connectivity"],
                            "layout": build.get("layout_validation"), "application_open": "not_run",
                            "simulation": "not_run"}
        provenance = json.loads((RUNTIME / "UPSTREAM.json").read_text(encoding="utf-8"))
        manifest = {"format": target, "circuit_sha256": circuit.digest(), "revision": revision,
                    "verification": verification, "warnings": warnings, "upstream": provenance,
                    "analysis": analysis.model_dump() if analysis else None,
                    "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in directory.iterdir() if p.is_file()}}
        (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        bundle_name = f"{target}-project.zip"
        with zipfile.ZipFile(directory / bundle_name, "w", zipfile.ZIP_DEFLATED) as bundle:
            for p in sorted(directory.iterdir()):
                if p.name != bundle_name:
                    bundle.write(p, p.name)
        # Publish the complete bundle with relative includes/symbols in one move.
        directory.rename(destination)
    return {"format": target, "directory": str(destination), "revision": revision,
            "schematic_path": str(destination / details["schematic"]),
            "bundle_path": str(destination / bundle_name),
            "paths": [str(p) for p in sorted(destination.iterdir())], "verification": verification,
            "warnings": warnings, "circuit_sha256": circuit.digest()}
