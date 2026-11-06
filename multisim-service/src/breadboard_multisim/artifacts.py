"""Reproducible reports and schematic/waveform exports from the actual IR/results."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import threading
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Circle, Polygon, Rectangle

from .measurements import Signals

PLOT_LOCK = threading.Lock()


def json_write(path, value):
    path = Path(path)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def schematic(circuit, directory: Path) -> list[str]:
    """Connected project, SPICE, SVG/HTML and PNG, all derived from one IR."""
    from .schematic import export_project, pin_offsets

    data, paths = export_project(circuit, directory)
    scene = data["schematic"]
    resolved = circuit.resolved_nodes()
    with PLOT_LOCK:
        scale = min(1, 3800 / max(scene["width"], scene["height"]))
        fig, ax = plt.subplots(figsize=(scene["width"] * scale / 120, scene["height"] * scale / 120), dpi=120)
        ax.set_xlim(0, scene["width"])
        ax.set_ylim(scene["height"], 0)
        ax.set_aspect("equal")
        ax.axis("off")
        ax.text(24, 28, circuit.title, fontsize=12, weight="bold")
        ax.text(
            24,
            49,
            "Connected signal wires; ground/supply labels are common. Crossings without dots are not junctions.",
            fontsize=7,
        )
        for wire in scene["wires"]:
            x, y = zip(*wire["points"])
            ax.plot(x, y, color="white", lw=3.5)
            ax.plot(x, y, color="#315d83", lw=1)
        for dot in scene["junctions"]:
            ax.plot(dot["x"], dot["y"], "o", color="#315d83", ms=3)
        for c in circuit.components:
            pos = scene["positions"][c.id]
            x, y = pos["x"], pos["y"]
            offsets = pin_offsets(c)
            if c.type == "opamp":
                ax.add_patch(
                    Polygon([(x - 36, y - 48), (x + 48, y), (x - 36, y + 48)], fc="white", ec="#172033")
                )
                for (a, b), (u, v) in zip(offsets, [(-36, -24), (-36, 24), (0, -28), (0, 28), (48, 0)]):
                    ax.plot([x + a, x + u], [y + b, y + v], color="#172033", lw=1)
                ax.text(x - 30, y - 21, "+", fontsize=8)
                ax.text(x - 30, y + 27, "−", fontsize=8)
            elif c.pins == 2:
                ax.plot([x - 48, x - 24], [y, y], color="#172033", lw=1)
                ax.plot([x + 24, x + 48], [y, y], color="#172033", lw=1)
                if c.type == "resistor":
                    ax.add_patch(Rectangle((x - 24, y - 9), 48, 18, fc="white", ec="#172033"))
                elif c.type == "capacitor":
                    ax.plot([x - 24, x - 6], [y, y], color="#172033")
                    ax.plot([x + 6, x + 24], [y, y], color="#172033")
                    for delta in [-6, 6]:
                        ax.plot([x + delta, x + delta], [y - 18, y + 18], color="#172033")
                elif c.type == "diode":
                    ax.add_patch(
                        Polygon([(x - 24, y - 17), (x + 24, y), (x - 24, y + 17)], fc="white", ec="#172033")
                    )
                    ax.plot([x + 24, x + 24], [y - 17, y + 17], color="#172033")
                elif c.type == "inductor":
                    t = np.linspace(0, 1, 80)
                    ax.plot(x - 24 + 48 * t, y - 12 * np.abs(np.sin(3 * np.pi * t)), color="#172033")
                else:
                    ax.add_patch(Circle((x, y), 24, fc="white", ec="#172033"))
                    ax.text(
                        x,
                        y,
                        "+ −" if c.type == "voltage_source" else "→",
                        ha="center",
                        va="center",
                        fontsize=8,
                    )
            else:
                half = max(36, math.ceil(c.pins / 2) * 12)
                ax.add_patch(Rectangle((x - 36, y - half), 72, 2 * half, fc="white", ec="#172033"))
                for a, b in offsets:
                    ax.plot([x + a, x + (-36 if a < 0 else 36)], [y + b, y + b], color="#172033", lw=1)
            label_y = y - max(96, math.ceil(c.pins / 2) * 12 + 48 if c.type == "ic" else 96)
            ax.text(x, label_y, c.id, ha="center", fontsize=8, weight="bold")
            ax.text(
                x,
                label_y + 16,
                str(c.model or ("BB_OPAMP" if c.type == "opamp" else c.value))[:42],
                ha="center",
                fontsize=6,
            )
            for (dx, dy), node in zip(offsets, resolved[c.id]):
                ax.plot(x + dx, y + dy, "o", color="#172033", ms=2)
                ax.text(
                    x + dx + (-6 if dx < 0 else 6),
                    y + dy - 8,
                    node,
                    ha="right" if dx < 0 else "left",
                    fontsize=5,
                )
        fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
        png = directory / "schematic.png"
        fig.savefig(png, dpi=120)
        plt.close(fig)
    return [*paths, str(png)]


def plot(
    raw, analysis, directory, output_node=None, input_node=None, start=None, stop=None, export_csv=False
):
    signals = Signals(raw, analysis["kind"])
    mask = np.ones(len(signals.axis), dtype=bool)
    if start is not None or stop is not None:
        if signals.kind != "tran":
            raise ValueError("Plot start/stop are transient time bounds in seconds")
        lower = signals.axis[0] if start is None else start
        upper = signals.axis[-1] if stop is None else stop
        if not np.isfinite([lower, upper]).all() or lower >= upper:
            raise ValueError("Plot window requires finite start < stop")
        if lower < signals.axis[0] or upper > signals.axis[-1]:
            raise ValueError("Plot window lies outside simulated time range")
        mask = (signals.axis >= lower) & (signals.axis <= upper)
        if np.count_nonzero(mask) < 2:
            raise ValueError("Plot window requires at least two simulated samples")
    axis = signals.axis[mask]
    # Resolve requested traces before allocating a figure, including missing-node errors.
    traces = {}
    if output_node:
        traces[f"v({output_node})"] = signals.voltage(output_node)[mask]
        if input_node:
            traces[f"v({input_node})"] = signals.voltage(input_node)[mask]
    elif input_node:
        raise ValueError("Specify output_node when selecting input_node")
    else:
        names = [name for name in signals.columns if name.startswith("v(") or "spectrum" in name][:12]
        if not names:
            names = list(signals.columns)[:6]
        traces = {name: signals.vector(name)[mask] for name in names}
    with PLOT_LOCK:
        if signals.kind == "ac" and output_node and input_node:
            denominator = signals.voltage(input_node)
            if np.any(np.abs(denominator) < 1e-30):
                raise ValueError("Bode plot requires nonzero input excitation")
            h = signals.voltage(output_node) / denominator
            fig, axes = plt.subplots(2, 1, figsize=(9, 6), sharex=True)
            axes[0].semilogx(signals.axis, 20 * np.log10(np.maximum(np.abs(h), 1e-300)))
            axes[0].set_ylabel("Gain (dB)")
            axes[1].semilogx(signals.axis, np.unwrap(np.angle(h)) * 180 / np.pi)
            axes[1].set_ylabel("Phase (degrees)")
            axes[1].set_xlabel("Frequency (Hz)")
            stem = "bode"
        else:
            fig, ax = plt.subplots(figsize=(9, 5))
            axes = [ax]
            for name, values in traces.items():
                if signals.kind in {"ac", "noise"}:
                    ax.loglog(axis, np.maximum(np.abs(values), 1e-300), label=name)
                elif len(axis) == 1:
                    ax.scatter([name], np.real(values), label=name)
                else:
                    ax.plot(axis, np.real(values), label=name)
            ax.set_xlabel(
                {
                    "tran": "Time (s)",
                    "ac": "Frequency (Hz)",
                    "noise": "Frequency (Hz)",
                    "dc": "Swept source (V or A)",
                    "op": "Vector",
                }[signals.kind]
            )
            ax.set_ylabel(
                "Noise density (V/√Hz or A/√Hz)"
                if signals.kind == "noise"
                else "Voltage (V) / labelled vector units"
            )
            ax.legend(fontsize=8)
            stem = "waveform"
        for ax in axes:
            ax.grid(True, alpha=0.2)
        fig.tight_layout()
        paths = []
        for ext in ("svg", "png"):
            path = directory / f"{stem}.{ext}"
            fig.savefig(path, dpi=150)
            paths.append(str(path))
        plt.close(fig)
    if export_csv:
        # Export every selected sample, never a decimated plotting approximation.
        # Keep the original all-vector data.csv and its manifest untouched.
        path = directory / "plotted-data.csv"
        complex_data = np.iscomplexobj(signals.data)
        header = [
            "frequency_Hz"
            if signals.kind in {"ac", "noise"}
            else "time_s"
            if signals.kind == "tran"
            else "axis"
        ]
        columns = [axis]
        for name, values in traces.items():
            if complex_data:
                header.extend([name + ".real", name + ".imag"])
                columns.extend([np.real(values), np.imag(values)])
            else:
                header.append(name)
                columns.append(np.real(values))
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(header)
            writer.writerows(zip(*columns))
        paths.append(str(path))
    return paths


def sweep_plot(rows, directory):
    keys = sorted({key for row in rows for key in row.get("parameters", {})})
    names = sorted({m["name"] for row in rows for m in row.get("measurements", [])})
    with (directory / "sweep.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["index", "run_id", "success", *keys, *names])
        writer.writeheader()
        for i, row in enumerate(rows):
            writer.writerow(
                {
                    "index": i,
                    "run_id": row.get("run_id"),
                    "success": row["success"],
                    **row.get("parameters", {}),
                    **{m["name"]: m.get("value") for m in row.get("measurements", [])},
                }
            )
    with PLOT_LOCK:
        fig, axes = plt.subplots(max(1, len(names)), 1, figsize=(8, max(3, 2.8 * len(names))), squeeze=False)
        for name, ax in zip(names, axes.flat):
            x, y = [], []
            for i, row in enumerate(rows):
                evidence = next((m for m in row.get("measurements", []) if m["name"] == name), {})
                if evidence.get("value") is not None:
                    x.append(row["parameters"][keys[0]] if len(keys) == 1 else i)
                    y.append(evidence["value"])
            ax.plot(x, y, "o-")
            ax.set_xlabel(keys[0] if len(keys) == 1 else "Candidate index")
            ax.set_ylabel(name)
            ax.grid(alpha=0.2)
        fig.tight_layout()
        for ext in ("svg", "png"):
            fig.savefig(directory / f"sweep.{ext}", dpi=150)
        plt.close(fig)


def manifest(directory: Path, metadata: dict):
    files = {}
    for file in sorted(directory.iterdir()):
        if file.is_file() and file.name != "manifest.json":
            files[file.name] = {
                "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
                "bytes": file.stat().st_size,
            }
    json_write(directory / "manifest.json", {"schema_version": 1, **metadata, "files": files})


def report(directory, circuit, result):
    lines = [
        f"# {circuit.title}",
        "",
        f"Backend: {result['backend']}. Circuit SHA-256: `{circuit.digest()}`.",
        "",
        f"Simulation: {'passed' if result['success'] else 'failed'}.",
        "",
        "| Measurement | Value | Unit | Status |",
        "| --- | --- | --- | --- |",
    ]
    for measurement in result.get("measurements", []):
        lines.append(
            f"| {measurement['name']} | {measurement.get('value')} | {measurement.get('unit', '')} | {measurement['status']} |"
        )
    lines.extend(
        [
            "",
            f"Requirements: **{result.get('verification', {}).get('verdict', 'unverified')}**.",
            "",
            "[Circuit IR](circuit.json) · [SPICE](circuit.cir) · [Data](data.csv) · [Log](run.log)",
            "",
        ]
    )
    checks = result.get("verification", {}).get("requirements", [])
    if checks:
        lines.extend(
            [
                "| Requirement | Measured value | Unit | Allowed range / target | Verdict |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for check in checks:
            constraint = check["constraint"]
            evidence = check.get("evidence", {})
            if constraint.get("target") is not None:
                allowed = (
                    f"target {constraint['target']}, absolute tolerance "
                    f"{constraint.get('absolute_tolerance', 0)}, relative tolerance "
                    f"{constraint.get('relative_tolerance', 0)}"
                )
            else:
                allowed = f"{constraint.get('minimum')} to {constraint.get('maximum')}"
            lines.append(
                f"| {constraint['measurement']['name']} | {evidence.get('value')} | "
                f"{evidence.get('unit', '')} | {allowed} | {check['verdict']} |"
            )
        lines.append("")
    if any(c.type == "opamp" and not c.model for c in circuit.components):
        lines.append(
            "Built-in op amp has finite gain and bandwidth and rail limiting, but no intrinsic noise, slew or output current limit. Use a validated vendor model for device-level claims."
        )
    for item in result.get("diagnostics", []):
        lines.append("\n" + json.dumps(item, ensure_ascii=False))
    for warning in result.get("artifact_warnings", []):
        lines.append("\nArtifact warning: " + warning)
    if circuit.assumptions:
        lines.extend(["", "Assumptions:", *[f"- {a}" for a in circuit.assumptions]])
    (directory / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
