"""Real simulator processes. No analytic solver or fabricated fallback results."""

from __future__ import annotations

import math
import os
import shutil
import subprocess
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Literal

from multisim_mcp.ngspice_backend import probe_ngspice
from multisim_mcp.safety import validate_analysis_commands
from multisim_mcp.spice_raw import parse_raw, write_csv
from pydantic import Field, model_validator

from .circuit import Circuit, Record, node_name


class Analysis(Record):
    kind: Literal["op", "dc", "ac", "tran", "noise"]
    start: float = 1
    stop: float = 1e6
    step: float = 1e-6
    points: int = Field(default=100, ge=2, le=10000)
    scale: Literal["dec", "oct", "lin"] = "dec"
    source: str = "V1"
    output: str = "vout"
    reference: str = "0"
    timeout: float = Field(default=60, gt=0, le=300)
    max_points: int = Field(default=200000, ge=1, le=1000000)

    @model_validator(mode="after")
    def check_limits(self):
        if self.kind in {"ac", "noise"}:
            if not 0 < self.start < self.stop:
                raise ValueError("Frequency range requires 0 < start < stop")
            estimate = (
                self.points
                if self.scale == "lin"
                else self.points * math.log(self.stop / self.start, 10 if self.scale == "dec" else 2) + 1
            )
        elif self.kind == "tran":
            if not 0 <= self.start < self.stop or self.step <= 0:
                raise ValueError("Transient requires 0 <= start < stop and step > 0")
            estimate = self.stop / self.step
        elif self.kind == "dc":
            if self.step == 0 or (self.stop - self.start) / self.step <= 0:
                raise ValueError("DC step must advance from start toward stop")
            estimate = (self.stop - self.start) / self.step + 1
        else:
            estimate = 1
        if estimate > self.max_points:
            raise ValueError(
                f"Analysis requests approximately {estimate:g} points; limit is {self.max_points}"
            )
        return self

    def command(self, circuit: Circuit) -> str:
        if self.kind == "op":
            command = "op"
        elif self.kind == "dc":
            source = circuit.component(self.source)
            if source.type not in {"voltage_source", "current_source"}:
                raise ValueError("DC sweep source must be an independent source")
            command = f"dc {source.id} {self.start:g} {self.stop:g} {self.step:g}"
        elif self.kind == "tran":
            command = f"tran {self.step:g} {self.stop:g} {self.start:g} {self.step:g}"
        else:
            sweep = f"{self.scale} {self.points} {self.start:g} {self.stop:g}"
            if self.kind == "ac":
                command = f"ac {sweep}"
            else:
                source = circuit.component(self.source)
                if source.type not in {"voltage_source", "current_source"} or not source.ac:
                    raise ValueError("Noise input must be an independent source with nonzero AC magnitude")
                available = {n for ns in circuit.resolved_nodes().values() for n in ns}
                output, reference = node_name(self.output), node_name(self.reference)
                if output not in available or reference not in available:
                    raise ValueError("Noise output/reference must exist in circuit")
                return f"noise v({output},{reference}) {source.id} {sweep}"
        validate_analysis_commands(command)
        return command


class SimulationError(RuntimeError):
    pass


class SimulatorBackend(ABC):
    name: str

    @abstractmethod
    def status(self) -> dict: ...

    @abstractmethod
    def run(self, circuit: Circuit, analysis: Analysis, directory: Path, cancelled=None) -> dict: ...


def executable_path() -> str | None:
    explicit = os.environ.get("BREADBOARD_NGSPICE")
    if explicit:
        return shutil.which(explicit) or (str(Path(explicit).resolve()) if Path(explicit).is_file() else None)
    system = shutil.which("ngspice_con") or shutil.which("ngspice")
    if system:
        return system
    # Source checkout setup; installed packages should use PATH or explicit configuration.
    root = Path(__file__).resolve().parents[3]
    for name in ("ngspice_con.exe", "ngspice.exe"):
        candidate = root / ".runtime/ngspice/Spice64/bin" / name
        if candidate.is_file():
            return str(candidate)
    return None


def parse_output(path: Path, analysis: Analysis) -> dict:
    if not path.is_file() or not path.stat().st_size:
        raise SimulationError("Simulator produced no raw data; inspect run.log")
    if path.stat().st_size > 256 * 1024 * 1024:
        raise SimulationError("Raw result exceeds 256 MiB limit")
    parsed = parse_raw(str(path))
    if parsed["n_points"] > analysis.max_points:
        raise SimulationError("Simulator adaptive output exceeds max_points; increase step or narrow range")
    for key in ("rows", "real_rows", "imaginary_rows"):
        if any(not math.isfinite(v) for row in parsed.get(key, []) for v in row):
            raise SimulationError("Non-finite simulation output")
    plot = parsed["header"].get("plotname", "").lower()
    expected = {"op": "operating point", "dc": "dc", "ac": "ac", "tran": "transient", "noise": "noise"}
    if expected[analysis.kind] not in plot:
        raise SimulationError(f"Expected {analysis.kind} result, received {plot}")
    write_csv(str(path.with_name("data.csv")), parsed)
    return parsed


class NgspiceBackend(SimulatorBackend):
    name = "ngspice"

    def __init__(self, executable: str | None = None):
        self.executable = executable or executable_path()

    def status(self):
        if not self.executable:
            return {
                "available": False,
                "backend": self.name,
                "repair": "Install ngspice or configure BREADBOARD_NGSPICE",
            }
        return {
            **probe_ngspice(self.executable),
            "backend": self.name,
            "analyses": ["op", "dc", "ac", "tran", "noise"],
        }

    def run(self, circuit, analysis, directory, cancelled=None):
        if not self.executable:
            raise SimulationError("ngspice is unavailable; run setup and runtime_status")
        command = analysis.command(circuit)
        netlist = circuit.netlist()
        # Save internal device currents when ngspice exposes a meaningful branch quantity.
        current_vectors = []
        for c in circuit.components:
            quantity = {
                "capacitor": "i",
                "inductor": "i",
                "diode": "id",
                "bjt": "ic",
                "mosfet": "id",
                "current_source": "current",
            }.get(c.type)
            if quantity and analysis.kind not in {"ac", "noise"}:
                current_vectors.append(f"@{c.id.lower()}[{quantity}]")
        controls = [
            ".control",
            "set filetype=ascii",
            "set numdgt=17",
            "save all " + " ".join(current_vectors),
            command,
        ]
        if analysis.kind == "noise":
            # ngspice makes a second integrated-noise plot current after noise analysis.
            controls.append("setplot noise1")
        controls.extend(["write result.raw all", "quit", ".endc", ".end", ""])
        deck = netlist.rsplit(".end", 1)[0] + "\n".join(controls)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "circuit.cir").write_text(deck, encoding="utf-8")
        (directory / "run.txt").write_text(command + "\n", encoding="utf-8")
        argv = [self.executable, "-n", "-b", "-o", "run.log", "circuit.cir"]
        environment = os.environ.copy()
        # Relocated Windows distributions cannot use their compiled-in /ucrt64
        # scripts path. Honor operator configuration, otherwise find the trusted
        # installation's spinit (which loads POLY/XSPICE device libraries).
        executable = Path(self.executable).resolve()
        for scripts in (executable.parent.parent / "share/ngspice/scripts", executable.parent):
            if (scripts / "spinit").is_file():
                environment.setdefault("SPICE_SCRIPTS", str(scripts))
                break
        started = time.monotonic()
        with (directory / "process.log").open("w", encoding="utf-8") as output:
            process = subprocess.Popen(
                argv,
                cwd=directory,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                env=environment,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            try:
                while process.poll() is None:
                    if cancelled and cancelled():
                        raise SimulationError("Simulation cancelled")
                    if time.monotonic() - started > analysis.timeout:
                        raise SimulationError(f"Simulation timed out after {analysis.timeout:g} seconds")
                    raw = directory / "result.raw"
                    if raw.exists() and raw.stat().st_size > 256 * 1024 * 1024:
                        raise SimulationError("Raw result exceeds 256 MiB limit")
                    time.sleep(0.025)
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()
        if process.returncode != 0:
            raise SimulationError(f"ngspice exited {process.returncode}; inspect run.log")
        log = (
            (directory / "run.log").read_text(encoding="utf-8", errors="replace")
            if (directory / "run.log").exists()
            else ""
        )
        if any(
            text in log.lower()
            for text in (
                "timestep too small",
                "simulation interrupted",
                "fatal error",
                "error on line",
                "doanalyses:",
            )
        ):
            raise SimulationError("ngspice analysis failed or was incomplete; inspect run.log")
        return parse_output(directory / "result.raw", analysis)


class MultisimBackend(SimulatorBackend):
    """Optional licensed NI backend using upstream's isolated 32-bit COM worker."""

    name = "multisim"

    def status(self):
        from multisim_mcp.com_worker_client import MultisimWorkerProcess, worker_runtime_diagnostics

        worker = MultisimWorkerProcess()
        try:
            return {
                "backend": self.name,
                **worker_runtime_diagnostics(worker),
                "analyses": ["op", "dc", "ac", "tran"],
            }
        finally:
            worker.close()

    def run(self, circuit, analysis, directory, cancelled=None):
        if os.name != "nt":
            raise SimulationError("NI Multisim COM requires Windows")
        if analysis.kind == "noise":
            raise ValueError("Use ngspice for noise; upstream COM safe command surface does not support it")
        # Lazy import: neither MCP nor COM state enters the open-source execution path.
        from multisim_mcp.server import _run_spice_netlist_impl, client

        directory.mkdir(parents=True, exist_ok=True)
        client.connect()
        try:
            result = _run_spice_netlist_impl(
                circuit.netlist(),
                analysis.command(circuit),
                str(directory),
                analysis.timeout,
                min(analysis.max_points, 100000),
                cancel_requested=cancelled,
            )
        finally:
            client.disconnect()
        if not result.get("success"):
            raise SimulationError(str(result.get("last_error") or result))
        return parse_output(directory / "result.raw", analysis)
