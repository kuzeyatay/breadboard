"""Durable circuit revisions and immutable experiment snapshots shared by all transports."""

from __future__ import annotations

import json
import os
import re
import uuid
from collections.abc import Callable
from pathlib import Path

from filelock import FileLock

from . import artifacts
from .backends import Analysis, MultisimBackend, NgspiceBackend, SimulatorBackend
from .circuit import Circuit, Component, Model
from .measurements import Constraint, Measurement, diagnose, measure, verify


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def atomic_json(path: Path, value):
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    artifacts.json_write(temporary, value)
    os.replace(temporary, path)


class CircuitService:
    def __init__(self, workspace: str | Path, backend: SimulatorBackend | None = None):
        self.root = Path(workspace).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.backend = backend or NgspiceBackend()
        for directory in ("circuits", "runs", "studies"):
            (self.root / directory).mkdir(exist_ok=True)

    def path(self, category, identifier):
        if category not in {"circuits", "runs", "studies"} or not re.fullmatch(r"[a-f0-9]{32}", identifier):
            raise ValueError("Invalid workspace object identifier")
        path = (self.root / category / identifier).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Workspace path escapes root")
        return path

    def runtime_status(self):
        from .exports import export_status

        return {
            "backend": self.backend.status(),
            "exporters": export_status(),
            "workspace": str(self.root),
            "ir_schema_version": 1,
            "upstream_commit": "33ec7f42bf2885084a459a702a83ea3d87f95f9d",
        }

    def create_circuit(self, circuit: dict | None = None, title="Circuit"):
        design = Circuit.model_validate(circuit or {"title": title})
        identifier = uuid.uuid4().hex
        path = self.path("circuits", identifier)
        path.mkdir()
        state = {"circuit_id": identifier, "revision": 1, "circuit": design.model_dump(mode="json")}
        atomic_json(path / "state.json", state)
        atomic_json(path / "revision-1.json", state)
        return state

    def load_circuit(self, circuit_id: str):
        return read_json(self.path("circuits", circuit_id) / "state.json")

    def import_circuit(self, path: str):
        # Explicit local import through CLI/MCP; Hermes supplies content through create_circuit.
        source = Path(path)
        if source.stat().st_size > 2_000_000:
            raise ValueError("Circuit JSON exceeds 2 MB")
        data = read_json(source)
        return self.create_circuit(data.get("circuit", data))

    def _edit(self, circuit_id: str, change: Callable, expected_revision: int | None = None):
        path = self.path("circuits", circuit_id)
        with FileLock(str(path / "edit.lock"), timeout=10):
            state = self.load_circuit(circuit_id)
            if expected_revision is not None and expected_revision != state["revision"]:
                raise ValueError(
                    f"Revision conflict: expected {expected_revision}, current {state['revision']}"
                )
            draft = state["circuit"]
            change(draft)
            design = Circuit.model_validate(draft)
            state = {
                "circuit_id": circuit_id,
                "revision": state["revision"] + 1,
                "circuit": design.model_dump(mode="json"),
            }
            atomic_json(path / f"revision-{state['revision']}.json", state)
            atomic_json(path / "state.json", state)
            return state

    def add_component(self, circuit_id, component, expected_revision=None):
        parsed = Component.model_validate(component)
        return self._edit(
            circuit_id, lambda draft: draft["components"].append(parsed.model_dump()), expected_revision
        )

    def remove_component(self, circuit_id, component_id, expected_revision=None):
        def change(draft):
            Circuit.model_validate(draft).component(component_id)
            draft["components"] = [c for c in draft["components"] if c["id"].lower() != component_id.lower()]
            draft["connections"] = [
                edge
                for edge in draft["connections"]
                if not any(e.lower().startswith(component_id.lower() + ".") for e in edge)
            ]

        return self._edit(circuit_id, change, expected_revision)

    def modify_component(self, circuit_id, component_id, changes, expected_revision=None):
        if "id" in changes or "type" in changes:
            raise ValueError("Changing component identity/type requires remove and add")

        def change(draft):
            c = Circuit.model_validate(draft).component(component_id)
            for index, item in enumerate(draft["components"]):
                if item["id"] == c.id:
                    draft["components"][index] = Component.model_validate({**item, **changes}).model_dump()

        return self._edit(circuit_id, change, expected_revision)

    def connect_components(self, circuit_id, endpoint_a, endpoint_b, expected_revision=None):
        return self._edit(
            circuit_id, lambda draft: draft["connections"].append([endpoint_a, endpoint_b]), expected_revision
        )

    def disconnect_components(self, circuit_id, endpoint_a, endpoint_b, expected_revision=None):
        def change(draft):
            pair = {endpoint_a.lower(), endpoint_b.lower()}
            original = draft["connections"]
            draft["connections"] = [e for e in original if {v.lower() for v in e} != pair]
            if len(original) == len(draft["connections"]):
                raise ValueError(
                    "Connection not found; nodes declared directly on a component are edited with modify_component"
                )

        return self._edit(circuit_id, change, expected_revision)

    def add_model(self, circuit_id, model, expected_revision=None):
        parsed = Model.model_validate(model)
        return self._edit(
            circuit_id, lambda draft: draft["models"].append(parsed.model_dump()), expected_revision
        )

    def export_netlist(self, circuit_id):
        state = self.load_circuit(circuit_id)
        circuit = Circuit.model_validate(state["circuit"])
        return {
            "circuit_id": circuit_id,
            "revision": state["revision"],
            "netlist": circuit.netlist(),
            "sha256": circuit.digest(),
        }

    def run(self, circuit_id, analysis, measurements=None, constraints=None, render=True):
        state = self.load_circuit(circuit_id)
        return self.run_snapshot(
            Circuit.model_validate(state["circuit"]),
            Analysis.model_validate(analysis),
            measurements or [],
            constraints or [],
            circuit_id,
            state["revision"],
            render=render,
        )

    def run_snapshot(
        self, circuit, analysis, measurements=(), constraints=(), circuit_id=None, revision=None, render=False
    ):
        measurements = [Measurement.model_validate(m) for m in measurements]
        constraints = [Constraint.model_validate(c) for c in constraints]
        circuit.netlist()
        analysis.command(circuit)
        run_id = uuid.uuid4().hex
        directory = self.path("runs", run_id)
        directory.mkdir()
        artifacts.json_write(directory / "circuit.json", circuit.model_dump())
        artifacts.json_write(directory / "analysis.json", analysis.model_dump())
        result = {
            "run_id": run_id,
            "circuit_id": circuit_id,
            "revision": revision,
            "circuit_sha256": circuit.digest(),
            "backend": self.backend.name,
            "analysis": analysis.model_dump(),
            "success": False,
            "directory": str(directory),
            "status": "running",
        }
        atomic_json(directory / "result.json", result)
        try:
            raw = self.backend.run(
                circuit, analysis, directory, cancelled=lambda: (directory / "cancel.requested").exists()
            )
            artifacts.json_write(directory / "data.json", raw)
            result.update(
                success=True,
                status="completed",
                n_points=raw["n_points"],
                columns=raw["columns"],
                measurements=[measure(circuit, raw, analysis.model_dump(), m) for m in measurements],
                verification=verify(circuit, raw, analysis.model_dump(), constraints),
            )
            result["diagnostics"] = diagnose(circuit, result["verification"])
            if render:
                try:
                    artifacts.schematic(circuit, directory)
                except ValueError as exc:
                    # Rendering limits do not invalidate already measured solver data.
                    # Export itself still fails explicitly, so a partial drawing
                    # cannot be handed off as a complete circuit project.
                    result["artifact_warnings"] = [f"Connected schematic unavailable: {exc}"]
                gain_spec = next((m for m in measurements if m.kind in {"gain", "bandwidth"}), None)
                artifacts.plot(
                    raw,
                    analysis.model_dump(),
                    directory,
                    gain_spec.node if gain_spec else None,
                    gain_spec.input_node if gain_spec else None,
                )
        except Exception as exc:  # noqa: BLE001 - persist a terminal record even for backend/plugin failures
            result.update(
                success=False,
                status="cancelled" if (directory / "cancel.requested").exists() else "failed",
                error=str(exc),
            )
            log = directory / "run.log"
            evidence = (
                str(exc)
                + "\n"
                + (log.read_text(encoding="utf-8", errors="replace")[-3000:] if log.exists() else "")
            )
            result["diagnostics"] = diagnose(circuit, error=evidence)
        atomic_json(directory / "result.json", result)
        artifacts.report(directory, circuit, result)
        artifacts.manifest(
            directory,
            {
                "run_id": run_id,
                "circuit_sha256": circuit.digest(),
                "backend": self.backend.status(),
                "analysis": analysis.model_dump(),
                "upstream_commit": "33ec7f42bf2885084a459a702a83ea3d87f95f9d",
            },
        )
        return result

    def get_run(self, run_id):
        return read_json(self.path("runs", run_id) / "result.json")

    def list_runs(self):
        paths = sorted(
            (self.root / "runs").glob("*/result.json"), key=lambda p: p.stat().st_mtime, reverse=True
        )[:100]
        return [
            {
                k: v
                for k, v in read_json(path).items()
                if k in {"run_id", "status", "success", "circuit_id", "revision"}
            }
            for path in paths
        ]

    def cancel_run(self, run_id):
        result = self.get_run(run_id)
        if result["status"] == "running":
            (self.path("runs", run_id) / "cancel.requested").touch()
        return {"run_id": run_id, "cancellation_requested": result["status"] == "running"}

    def _run_data(self, run_id):
        result = self.get_run(run_id)
        if not result["success"]:
            raise ValueError("Failed run has no verified measurement data")
        directory = self.path("runs", run_id)
        return (
            Circuit.model_validate(read_json(directory / "circuit.json")),
            read_json(directory / "data.json"),
            result["analysis"],
        )

    def measure(self, run_id, measurement):
        circuit, raw, analysis = self._run_data(run_id)
        return {"run_id": run_id, **measure(circuit, raw, analysis, Measurement.model_validate(measurement))}

    def verify_constraints(self, run_id, constraints):
        circuit, raw, analysis = self._run_data(run_id)
        result = verify(circuit, raw, analysis, [Constraint.model_validate(c) for c in constraints])
        return {"run_id": run_id, **result, "diagnostics": diagnose(circuit, result)}

    def render_schematic(self, circuit_id):
        state = self.load_circuit(circuit_id)
        target = self.path("circuits", circuit_id) / f"schematic-{state['revision']}"
        target.mkdir(exist_ok=True)
        paths = artifacts.schematic(Circuit.model_validate(state["circuit"]), target)
        project = read_json(target / "circuit.bbcir")
        return {
            "circuit_id": circuit_id,
            "revision": state["revision"],
            "paths": paths,
            "project_path": str(target / "circuit.bbcir"),
            "view_path": str(target / "schematic.html"),
            "connected": project["schematic"]["connected"],
            "review": project["review"],
        }

    def export_circuit_project(self, circuit_id):
        return self.render_schematic(circuit_id)

    def export_native_circuit(self, circuit_id, target, analysis=None):
        from .exports import export_circuit

        state = self.load_circuit(circuit_id)
        result = export_circuit(Circuit.model_validate(state["circuit"]), self.path("circuits", circuit_id),
                                state["revision"], target, Analysis.model_validate(analysis) if analysis else None)
        return {"circuit_id": circuit_id, **result}

    def plot_results(self, run_id, output_node=None, input_node=None, start=None, stop=None):
        _, raw, analysis = self._run_data(run_id)
        # Derived artifacts get a separate directory; original run manifests stay immutable.
        target = self.path("runs", run_id) / "plots" / uuid.uuid4().hex
        target.mkdir(parents=True)
        return {
            "paths": artifacts.plot(
                raw, analysis, target, output_node, input_node, start, stop, export_csv=True
            )
        }

    def inspect_artifacts(self, run_id):
        directory = self.path("runs", run_id)
        manifest = read_json(directory / "manifest.json")
        import hashlib

        checks = {
            name: (directory / name).is_file()
            and hashlib.sha256((directory / name).read_bytes()).hexdigest() == record["sha256"]
            for name, record in manifest["files"].items()
        }
        return {"run_id": run_id, "integrity_ok": all(checks.values()), "files": checks, "manifest": manifest}


def service_for(workspace, backend="ngspice"):
    if backend not in {"ngspice", "multisim"}:
        raise ValueError("Unknown simulator backend")
    return CircuitService(workspace, NgspiceBackend() if backend == "ngspice" else MultisimBackend())
