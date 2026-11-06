"""One typed tool contract for native Hermes, CLI and MCP."""

from __future__ import annotations

import inspect
from importlib.resources import files
from typing import Any, Literal, get_type_hints

from pydantic import create_model

from .backends import Analysis
from .circuit import Circuit, Component, Model
from .measurements import Constraint, Measurement
from .optimization import (
    Objective,
    Variable,
    apply_optimized_values,
    monte_carlo_analysis,
    optimize_values,
    parameter_sweep,
)
from .service import CircuitService, read_json


class Tools:
    def __init__(self, service: CircuitService):
        self.service = service

    def runtime_status(self) -> dict:
        """Check simulator availability and workspace without running a circuit."""
        return self.service.runtime_status()

    def describe_tool(self, name: str) -> dict:
        """Get the complete JSON argument schema and description for a native circuit operation."""
        if name not in CONTRACTS:
            raise ValueError(f"Unknown tool {name}; available: {list(CONTRACTS)}")
        return CONTRACTS[name][1]

    def read_reference(
        self,
        name: Literal[
            "design",
            "simulate",
            "debug",
            "optimize",
            "divider",
            "rc-filter",
            "transistor-amplifier",
            "opamp-amplifier",
            "mosfet-switch",
            "exports",
        ],
    ) -> dict:
        """Read a shipped engineering workflow or editable example. Available in chat without filesystem tools."""
        suffix = ".md" if name in {"design", "simulate", "debug", "optimize", "exports"} else ".json"
        return {
            "name": name,
            "format": "markdown" if suffix == ".md" else "json",
            "content": files("breadboard_multisim")
            .joinpath("references", name + suffix)
            .read_text(encoding="utf-8"),
        }

    def create_circuit(self, circuit: Circuit | None = None, title: str = "Circuit") -> dict:
        """Create a persisted circuit, optionally from complete circuit JSON. Returns circuit_id and revision."""
        return self.service.create_circuit(circuit.model_dump() if circuit else None, title)

    def load_circuit(self, circuit_id: str) -> dict:
        """Load an existing circuit's current revision and full editable IR."""
        return self.service.load_circuit(circuit_id)

    def add_component(
        self, circuit_id: str, component: Component, expected_revision: int | None = None
    ) -> dict:
        """Add a component with ordered nodes or wire its numbered pins in later calls."""
        return self.service.add_component(circuit_id, component.model_dump(), expected_revision)

    def remove_component(
        self, circuit_id: str, component_id: str, expected_revision: int | None = None
    ) -> dict:
        """Remove a component and its explicit pin connections in a new revision."""
        return self.service.remove_component(circuit_id, component_id, expected_revision)

    def connect_components(
        self, circuit_id: str, endpoint_a: str, endpoint_b: str, expected_revision: int | None = None
    ) -> dict:
        """Connect component pins such as R1.1 to a named node or another pin; GND maps to 0."""
        return self.service.connect_components(circuit_id, endpoint_a, endpoint_b, expected_revision)

    def disconnect_components(
        self, circuit_id: str, endpoint_a: str, endpoint_b: str, expected_revision: int | None = None
    ) -> dict:
        """Remove an explicit pin connection. Direct component nodes use modify_component instead."""
        return self.service.disconnect_components(circuit_id, endpoint_a, endpoint_b, expected_revision)

    def modify_component(
        self,
        circuit_id: str,
        component_id: str,
        changes: dict[str, Any],
        expected_revision: int | None = None,
    ) -> dict:
        """Update value, nodes, model, parameters, AC stimulus or tolerance; detect stale revisions."""
        return self.service.modify_component(circuit_id, component_id, changes, expected_revision)

    def add_model(self, circuit_id: str, model: Model, expected_revision: int | None = None) -> dict:
        """Add an inline .model or .subckt with explicit provenance; external includes are not executed."""
        return self.service.add_model(circuit_id, model.model_dump(), expected_revision)

    def export_netlist(self, circuit_id: str) -> dict:
        """Validate all connections and model references and generate a deterministic SPICE netlist."""
        return self.service.export_netlist(circuit_id)

    def export_ltspice(self, circuit_id: str, analysis: Analysis | None = None) -> dict:
        """Export an editable LTspice .asc using Weave with verified pin connectivity.

        Includes custom .asy symbols and inline models in a portable ZIP. Optional
        analysis adds an LTspice directive. Import bundle_path with artifact_import;
        extract the entire ZIP before opening schematic_path. Does not run simulation.
        """
        return self.service.export_native_circuit(circuit_id, "ltspice", analysis.model_dump() if analysis else None)

    def export_multisim(self, circuit_id: str) -> dict:
        """Export a native editable Multisim .ms14 through multisim-mcp and the EW codec.

        Requires a locally provisioned NI component pack (see runtime_status).
        Unsupported models fail explicitly. Returns the .ms14 and portable ZIP;
        import them with artifact_import. Does not open Multisim or run simulation.
        """
        return self.service.export_native_circuit(circuit_id, "multisim")

    def run_circuit_experiment(
        self,
        circuit_id: str,
        analysis: Analysis,
        measurements: list[Measurement] | None = None,
        constraints: list[Constraint] | None = None,
        render: bool = True,
    ) -> dict:
        """Simulate a circuit snapshot; retain raw data, CSV, diagrams, report and checksummed evidence."""
        return self.service.run(
            circuit_id,
            analysis.model_dump(),
            [m.model_dump() for m in (measurements or [])],
            [c.model_dump() for c in (constraints or [])],
            render,
        )

    def run_operating_point(self, circuit_id: str) -> dict:
        """Compute the DC operating point using the real simulator."""
        return self.service.run(circuit_id, {"kind": "op"})

    def run_dc_sweep(self, circuit_id: str, source: str, start: float, stop: float, step: float) -> dict:
        """Sweep an independent voltage/current source; SI units."""
        return self.service.run(
            circuit_id, {"kind": "dc", "source": source, "start": start, "stop": stop, "step": step}
        )

    def run_ac_analysis(
        self,
        circuit_id: str,
        start: float = 1,
        stop: float = 1e6,
        points: int = 100,
        scale: Literal["dec", "oct", "lin"] = "dec",
    ) -> dict:
        """Run small-signal AC analysis; points per decade/octave or total linear points; frequency in Hz."""
        return self.service.run(
            circuit_id, {"kind": "ac", "start": start, "stop": stop, "points": points, "scale": scale}
        )

    def run_transient_analysis(self, circuit_id: str, stop: float, step: float, start: float = 0) -> dict:
        """Run time-domain simulation; step bounds internal timesteps; all times in seconds."""
        return self.service.run(circuit_id, {"kind": "tran", "start": start, "stop": stop, "step": step})

    def run_noise_analysis(
        self,
        circuit_id: str,
        output: str,
        source: str,
        start: float = 1,
        stop: float = 1e6,
        points: int = 100,
        reference: str = "0",
    ) -> dict:
        """Run ngspice small-signal noise analysis with a declared input source and output node."""
        return self.service.run(
            circuit_id,
            {
                "kind": "noise",
                "output": output,
                "source": source,
                "start": start,
                "stop": stop,
                "points": points,
                "reference": reference,
            },
        )

    def measure_voltage(
        self,
        run_id: str,
        node: str,
        reference: str = "0",
        statistic: Literal["mean", "rms", "min", "max", "peak_to_peak", "last"] = "mean",
        frequency: float | None = None,
        start: float | None = None,
        stop: float | None = None,
    ) -> dict:
        """Measure differential voltage; transient averages are time-weighted; AC needs frequency."""
        return self.service.measure(
            run_id,
            {
                "kind": "voltage",
                "name": "voltage",
                "node": node,
                "reference": reference,
                "statistic": statistic,
                "frequency": frequency,
                "start": start,
                "stop": stop,
            },
        )

    def measure_frequency(
        self, run_id: str, node: str, start: float, stop: float, reference: str = "0"
    ) -> dict:
        """Measure actual oscillator frequency from at least five settled transient cycles."""
        return self.service.measure(
            run_id,
            {
                "kind": "frequency",
                "name": "frequency",
                "node": node,
                "reference": reference,
                "start": start,
                "stop": stop,
            },
        )

    def measure_distortion(
        self, run_id: str, node: str, start: float, stop: float, harmonics: int = 10, reference: str = "0"
    ) -> dict:
        """Measure THD percent through the requested harmonic; requires settled, finely sampled transient data."""
        return self.service.measure(
            run_id,
            {
                "kind": "thd",
                "name": "thd",
                "node": node,
                "reference": reference,
                "start": start,
                "stop": stop,
                "harmonics": harmonics,
            },
        )

    def measure_current(
        self,
        run_id: str,
        component: str,
        frequency: float | None = None,
        statistic: Literal["mean", "rms", "min", "max", "peak_to_peak", "last"] = "mean",
        start: float | None = None,
        stop: float | None = None,
    ) -> dict:
        """Measure element branch current (BJT collector/MOS drain); use a 0 V source for other IC pins."""
        return self.service.measure(
            run_id,
            {
                "kind": "current",
                "name": "current",
                "component": component,
                "frequency": frequency,
                "statistic": statistic,
                "start": start,
                "stop": stop,
            },
        )

    def measure_power(
        self,
        run_id: str,
        component: str,
        frequency: float | None = None,
        start: float | None = None,
        stop: float | None = None,
    ) -> dict:
        """Measure absorbed two-terminal power; AC computes average real power from peak phasors."""
        return self.service.measure(
            run_id,
            {
                "kind": "power",
                "name": "power",
                "component": component,
                "frequency": frequency,
                "start": start,
                "stop": stop,
            },
        )

    def measure_gain(self, run_id: str, node: str, input_node: str, frequency: float) -> dict:
        """Measure AC voltage gain in dB with linear magnitude and phase evidence."""
        return self.service.measure(
            run_id,
            {"kind": "gain", "name": "gain", "node": node, "input_node": input_node, "frequency": frequency},
        )

    def measure_bandwidth(
        self,
        run_id: str,
        node: str,
        input_node: str,
        reference_frequency: float | None = None,
        drop_db: float = 3.01029995664,
    ) -> dict:
        """Measure upper cutoff relative to passband reference, interpolating in log frequency; no extrapolation."""
        return self.service.measure(
            run_id,
            {
                "kind": "bandwidth",
                "name": "bandwidth",
                "node": node,
                "input_node": input_node,
                "reference_frequency": reference_frequency,
                "drop_db": drop_db,
            },
        )

    def measure_phase_margin(
        self, run_id: str, node: str, input_node: str, loop_gain: bool = False, loop_sign: Literal[1, -1] = 1
    ) -> dict:
        """Measure phase margin only from an explicit, bias-preserving loop-gain testbench."""
        return self.service.measure(
            run_id,
            {
                "kind": "phase_margin",
                "name": "phase_margin",
                "node": node,
                "input_node": input_node,
                "loop_gain": loop_gain,
                "loop_sign": loop_sign,
            },
        )

    def measure_noise(self, run_id: str, frequency: float | None = None) -> dict:
        """Measure output noise density at a frequency or integrated output RMS noise over the simulated band."""
        return self.service.measure(run_id, {"kind": "noise", "name": "noise", "frequency": frequency})

    def verify_constraints(self, run_id: str, constraints: list[Constraint]) -> dict:
        """Return pass/fail/unverified for numeric requirements, with measurements and diagnostic hypotheses."""
        return self.service.verify_constraints(run_id, [c.model_dump() for c in (constraints or [])])

    def parameter_sweep(
        self,
        circuit_id: str,
        analysis: Analysis,
        parameters: dict[str, list[float | str]],
        measurements: list[Measurement] | None = None,
        constraints: list[Constraint] | None = None,
        timeout: float = 600,
    ) -> dict:
        """Evaluate a Cartesian product of component values/parameters, max 100 runs, without changing the baseline."""
        return parameter_sweep(
            self.service,
            circuit_id,
            analysis.model_dump(),
            parameters,
            [m.model_dump() for m in (measurements or [])],
            [c.model_dump() for c in (constraints or [])],
            timeout,
        )

    def monte_carlo_analysis(
        self,
        circuit_id: str,
        analysis: Analysis,
        samples: int = 30,
        seed: int = 0,
        distribution: Literal["uniform", "normal"] = "uniform",
        measurements: list[Measurement] | None = None,
        constraints: list[Constraint] | None = None,
        timeout: float = 600,
    ) -> dict:
        """Seeded component-tolerance simulation; normal tolerance means untruncated 3 sigma; max 100 samples."""
        return monte_carlo_analysis(
            self.service,
            circuit_id,
            analysis.model_dump(),
            samples,
            seed,
            distribution,
            [m.model_dump() for m in (measurements or [])],
            [c.model_dump() for c in (constraints or [])],
            timeout,
        )

    def optimize_values(
        self,
        circuit_id: str,
        analysis: Analysis,
        variables: list[Variable],
        objectives: list[Objective],
        constraints: list[Constraint] | None = None,
        max_evaluations: int = 30,
        seed: int = 0,
        timeout: float = 600,
    ) -> dict:
        """Bounded seeded optimization with hard constraints, evidence for each candidate and a fresh final verification."""
        return optimize_values(
            self.service,
            circuit_id,
            analysis.model_dump(),
            [v.model_dump() for v in variables],
            [o.model_dump() for o in objectives],
            [c.model_dump() for c in (constraints or [])],
            max_evaluations,
            seed,
            timeout,
        )

    def apply_optimized_values(self, study_id: str, expected_revision: int) -> dict:
        """Apply a verified candidate only if the baseline revision still matches."""
        return apply_optimized_values(self.service, study_id, expected_revision)

    def get_study(self, study_id: str) -> dict:
        """Read durable study progress, per-candidate evidence and final outcome."""
        return read_json(self.service.path("studies", study_id) / "summary.json")

    def cancel_study(self, study_id: str) -> dict:
        """Cancel a study before its next candidate; current simulation retains its own bounded timeout."""
        path = self.service.path("studies", study_id)
        result = read_json(path / "summary.json")
        if result["status"] == "running":
            (path / "cancel.requested").touch()
        return {"study_id": study_id, "cancellation_requested": result["status"] == "running"}

    def render_schematic(self, circuit_id: str) -> dict:
        """Export connected wires as SVG/PNG/HTML plus a reopenable .bbcir circuit project and SPICE."""
        return self.service.render_schematic(circuit_id)

    def export_circuit_project(self, circuit_id: str) -> dict:
        """Deliver .bbcir, SPICE, JSON, connected SVG/PNG and viewable HTML.

        Import project_path and view_path as Breadboard artifacts. Review reports
        unused terminals and component counts; export alone does not verify a lab.
        """
        return self.service.export_circuit_project(circuit_id)

    def import_circuit_project(self, project: dict) -> dict:
        """Reopen a .bbcir object as a new editable circuit, preserving the old design."""
        from .schematic import SCHEMA

        if project.get("schema") != SCHEMA:
            raise ValueError("Unsupported Breadboard circuit project version")
        circuit = Circuit.model_validate(project.get("circuit"))
        if circuit.netlist() != project.get("netlist") or circuit.digest() != project.get("circuit_sha256"):
            raise ValueError("Project circuit, netlist and integrity hash disagree")
        return self.service.create_circuit(circuit.model_dump())

    def plot_results(
        self,
        run_id: str,
        output_node: str | None = None,
        input_node: str | None = None,
        start: float | None = None,
        stop: float | None = None,
    ) -> dict:
        """Export SVG/PNG and full-resolution selected-trace CSV; AC node pair gives Bode.

        Transient start/stop in seconds select a readable settled or fault window.
        Without nodes, plots up to 12 available voltage/noise traces.
        Selected CSV fits chat exports without changing the original all-vector data.
        """
        return self.service.plot_results(run_id, output_node, input_node, start, stop)

    def get_run(self, run_id: str) -> dict:
        """Read persisted run status, measurements, verification and artifact directory."""
        return self.service.get_run(run_id)

    def list_runs(self) -> list:
        """List the latest 100 runs in this workspace, including in-progress run IDs for cancellation."""
        return self.service.list_runs()

    def cancel_run(self, run_id: str) -> dict:
        """Request cancellation of a live ngspice/COM run while retaining its diagnostic artifacts."""
        return self.service.cancel_run(run_id)

    def inspect_artifacts(self, run_id: str) -> dict:
        """Verify all experiment files against their SHA-256 manifest."""
        return self.service.inspect_artifacts(run_id)


def contracts():
    result = {}
    for name, function in inspect.getmembers(Tools, inspect.isfunction):
        if name.startswith("_"):
            continue
        hints = get_type_hints(function)
        fields = {}
        for key, param in inspect.signature(function).parameters.items():
            if key != "self":
                fields[key] = (hints[key], ... if param.default is inspect.Parameter.empty else param.default)
        model = create_model(
            name + "Arguments", __config__={"extra": "forbid", "allow_inf_nan": False}, **fields
        )
        result[name] = (
            model,
            {"name": name, "description": inspect.getdoc(function), "inputSchema": model.model_json_schema()},
        )
    return result


CONTRACTS = contracts()


def dispatch(service, tool, arguments):
    if tool not in CONTRACTS:
        raise ValueError(f"Unknown circuit tool {tool}")
    arguments = CONTRACTS[tool][0].model_validate(arguments)
    return getattr(Tools(service), tool)(
        **{key: getattr(arguments, key) for key in type(arguments).model_fields}
    )
