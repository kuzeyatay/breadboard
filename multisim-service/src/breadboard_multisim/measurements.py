"""Engineering measurements retain phase and never extrapolate missing evidence."""

from __future__ import annotations

from itertools import pairwise
from typing import Literal

import numpy as np
from pydantic import Field, model_validator

from .circuit import Circuit, Record, node_name, number


class Measurement(Record):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["voltage", "current", "power", "gain", "bandwidth", "phase_margin", "noise", "frequency", "thd"]
    node: str = "vout"
    reference: str = "0"
    component: str | None = None
    input_node: str = "vin"
    frequency: float | None = Field(default=None, gt=0)
    statistic: Literal["mean", "rms", "min", "max", "peak_to_peak", "last"] = "mean"
    start: float | None = None
    stop: float | None = None
    reference_frequency: float | None = Field(default=None, gt=0)
    drop_db: float = Field(default=3.01029995664, gt=0)
    loop_gain: bool = False
    loop_sign: Literal[1, -1] = 1
    harmonics: int = Field(default=10, ge=2, le=20)

    @model_validator(mode="after")
    def required_component(self):
        if self.kind in {"current", "power"} and not self.component:
            raise ValueError("Current and power measurements require a component")
        return self


class Constraint(Record):
    measurement: Measurement
    minimum: float | None = None
    maximum: float | None = None
    target: float | None = None
    absolute_tolerance: float = Field(default=0, ge=0)
    relative_tolerance: float = Field(default=0, ge=0)

    @model_validator(mode="after")
    def limits(self):
        if self.minimum is None and self.maximum is None and self.target is None:
            raise ValueError("Constraint needs minimum, maximum or target")
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("Constraint minimum exceeds maximum")
        return self


class EvidenceUnavailable(ValueError):
    pass


class Signals:
    def __init__(self, raw: dict, kind: str):
        self.kind = kind
        self.data = np.asarray(raw.get("real_rows", raw["rows"]), dtype=float)
        if "imaginary_rows" in raw:
            self.data = self.data + 1j * np.asarray(raw["imaginary_rows"])
        self.columns = {v["name"].lower(): i for i, v in enumerate(raw["variables"])}
        self.axis = np.real(self.data[:, 0])

    def vector(self, name):
        if name.lower() not in self.columns:
            raise EvidenceUnavailable(f"Missing simulated vector {name}; available: {list(self.columns)}")
        return self.data[:, self.columns[name.lower()]]

    def voltage(self, node, reference="0"):
        def v(n):
            n = node_name(n)
            return np.zeros(len(self.axis)) if n == "0" else self.vector(f"v({n})")

        return v(node) - v(reference)

    def current(self, circuit, ref):
        c = circuit.component(ref)
        if c.type == "resistor":
            nodes = circuit.resolved_nodes()[c.id]
            return self.voltage(*nodes) / number(c.value)
        if c.type in {"capacitor", "inductor"} and self.kind == "ac":
            voltage = self.voltage(*circuit.resolved_nodes()[c.id])
            impedance = 1j * 2 * np.pi * self.axis * number(c.value)
            return voltage * impedance if c.type == "capacitor" else voltage / impedance
        if c.type == "voltage_source":
            return self.vector(f"i({c.id.lower()})")
        param = {
            "capacitor": "i",
            "inductor": "i",
            "diode": "id",
            "bjt": "ic",
            "mosfet": "id",
            "current_source": "current",
        }.get(c.type)
        if not param:
            raise EvidenceUnavailable("Insert a 0 V sense source to measure this model's terminal current")
        return self.vector(f"i(@{c.id.lower()}[{param}])")

    def at(self, values, frequency):
        if self.kind not in {"ac", "noise"}:
            raise EvidenceUnavailable("Frequency measurement requires AC or noise analysis")
        if frequency is None:
            raise EvidenceUnavailable("Specify a measurement frequency")
        if not self.axis[0] <= frequency <= self.axis[-1]:
            raise EvidenceUnavailable("Requested frequency lies outside simulated range")
        return np.interp(np.log(frequency), np.log(self.axis), values)

    def transfer(self, spec):
        if self.kind != "ac":
            raise EvidenceUnavailable("Transfer measurements require AC analysis")
        vin = self.voltage(spec.input_node)
        if np.any(np.abs(vin) < 1e-30):
            raise EvidenceUnavailable("Input excitation is zero; set an AC source")
        return self.voltage(spec.node, spec.reference) / vin


def reduce_samples(signals, values, spec):
    if signals.kind == "ac":
        return signals.at(values, spec.frequency)
    if signals.kind == "noise":
        raise EvidenceUnavailable("Use a noise measurement for spectral density")
    mask = np.ones(len(signals.axis), dtype=bool)
    if spec.start is not None:
        mask &= signals.axis >= spec.start
    if spec.stop is not None:
        mask &= signals.axis <= spec.stop
    if not mask.any():
        raise EvidenceUnavailable("Measurement window contains no samples")
    y, x = np.real(values[mask]), signals.axis[mask]
    if spec.statistic in {"mean", "rms"}:
        transformed = y**2 if spec.statistic == "rms" else y
        # SPICE transient samples are nonuniform; arithmetic mean is biased.
        if len(x) > 1 and signals.kind == "tran":
            average = np.trapezoid(transformed, x) / (x[-1] - x[0])
        else:
            average = np.mean(transformed)
        return float(np.sqrt(average) if spec.statistic == "rms" else average)
    return float(
        {"min": np.min, "max": np.max, "peak_to_peak": np.ptp, "last": lambda v: v[-1]}[spec.statistic](y)
    )


def crossing(axis, values, threshold, start_index=0):
    hits = np.flatnonzero((values[start_index:-1] >= threshold) & (values[start_index + 1 :] < threshold))
    if not len(hits):
        raise EvidenceUnavailable("No descending crossing in simulated range; widen the sweep")
    index = int(hits[0]) + start_index
    alpha = (threshold - values[index]) / (values[index + 1] - values[index])
    return float(np.exp(np.log(axis[index]) + alpha * np.log(axis[index + 1] / axis[index]))), index, alpha


def periodic_waveform(signals: Signals, spec: Measurement) -> dict:
    """Measure a settled periodic waveform, without assuming its requested frequency."""
    if signals.kind != "tran":
        raise EvidenceUnavailable("Oscillation frequency and THD require a transient simulation")
    t = signals.axis
    if spec.start is None or spec.stop is None or not t[0] <= spec.start < spec.stop <= t[-1]:
        raise EvidenceUnavailable("Specify a settled start/stop window inside the simulated interval")
    inside = (t > spec.start) & (t < spec.stop)
    x = np.r_[spec.start, t[inside], spec.stop]
    y = np.interp(x, t, np.real(signals.voltage(spec.node, spec.reference)))
    if len(x) < 32 or np.any(np.diff(x) <= 0) or np.ptp(y) < 1e-9:
        raise EvidenceUnavailable("Insufficient nonzero transient samples for periodic measurement")
    offset = np.trapezoid(y, x) / (x[-1] - x[0])
    centered = y - offset
    indices = np.flatnonzero((centered[:-1] < 0) & (centered[1:] >= 0))
    crossings = x[indices] - centered[indices] * np.diff(x)[indices] / np.diff(centered)[indices]
    if len(crossings) < 6:
        raise EvidenceUnavailable("Measure at least five complete settled cycles")
    periods = np.diff(crossings)
    frequency = 1 / np.mean(periods)
    if np.ptp(periods) / np.mean(periods) > 0.02:
        raise EvidenceUnavailable("Periods vary by more than 2%; waveform is not a stable oscillator")
    # Four samples per highest requested harmonic, based on the largest actual
    # SPICE step, prevents interpolation from pretending to create bandwidth.
    if np.max(np.diff(x)) * frequency * spec.harmonics > 0.25:
        raise EvidenceUnavailable("Timestep is too coarse for the requested harmonics; reduce it")
    peaks = [np.ptp(y[(x >= a) & (x <= b)]) for a, b in pairwise(crossings)]
    if np.ptp(peaks) / np.mean(peaks) > 0.02:
        raise EvidenceUnavailable("Amplitude varies by more than 2%; choose a settled measurement window")
    interior = (x > crossings[0]) & (x < crossings[-1])
    fit_x = np.r_[crossings[0], x[interior], crossings[-1]]
    fit_y = np.interp(fit_x, x, y)
    phase = 2 * np.pi * frequency * (fit_x - fit_x[0])
    basis = np.column_stack([np.ones(len(phase))] + [
        fn(k * phase) for k in range(1, spec.harmonics + 1) for fn in (np.cos, np.sin)
    ])
    weights = np.r_[np.diff(fit_x)[0], fit_x[2:] - fit_x[:-2], np.diff(fit_x)[-1]] / 2
    weighted = np.sqrt(weights / weights.sum())
    coefficients = np.linalg.lstsq(basis * weighted[:, None], fit_y * weighted, rcond=None)[0]
    amplitudes = np.hypot(coefficients[1::2], coefficients[2::2])
    if amplitudes[0] < 1e-9:
        raise EvidenceUnavailable("No measurable fundamental")
    return {
        "frequency_hz": float(frequency),
        "thd_percent": float(100 * np.linalg.norm(amplitudes[1:]) / amplitudes[0]),
        "fundamental_peak_v": float(amplitudes[0]),
        "dc_v": float(coefficients[0]),
        "harmonic_peak_v": amplitudes.tolist(),
        "cycles": len(periods),
        "window_s": [float(fit_x[0]), float(fit_x[-1])],
        "definition": "Rising crossings and time-weighted harmonic least squares over complete cycles; THD excludes noise",
    }


def measure(circuit: Circuit, raw: dict, analysis: dict, spec: Measurement) -> dict:
    try:
        s = Signals(raw, analysis["kind"])
        extra = {}
        if spec.kind == "voltage":
            value, unit = reduce_samples(s, s.voltage(spec.node, spec.reference), spec), "V"
        elif spec.kind == "current":
            value, unit = reduce_samples(s, s.current(circuit, spec.component), spec), "A"
        elif spec.kind == "power":
            c = circuit.component(spec.component)
            if c.pins != 2:
                raise EvidenceUnavailable(
                    "Power requires a two-terminal element; measure each IC supply separately"
                )
            v = s.voltage(*circuit.resolved_nodes()[c.id])
            current = s.current(circuit, c.id)
            if s.kind == "ac":
                value = 0.5 * float(np.real(s.at(v, spec.frequency) * np.conj(s.at(current, spec.frequency))))
                extra["convention"] = "Average real small-signal power, peak phasors; positive is absorbed"
            else:
                value = reduce_samples(s, v * current, spec)
                extra["convention"] = (
                    "Positive is absorbed; independent sources commonly deliver negative power"
                )
            unit = "W"
        elif spec.kind == "noise":
            if s.kind != "noise":
                raise EvidenceUnavailable("Noise requires a noise simulation and noise-capable device models")
            density = np.real(s.vector("onoise_spectrum"))
            if spec.frequency is not None:
                value, unit = float(s.at(density, spec.frequency)), "V/sqrt(Hz)"
            else:
                value, unit = float(np.sqrt(np.trapezoid(density**2, s.axis))), "V RMS"
                extra["integration_band_hz"] = [float(s.axis[0]), float(s.axis[-1])]
        elif spec.kind in {"frequency", "thd"}:
            extra = periodic_waveform(s, spec)
            value, unit = ((extra["frequency_hz"], "Hz") if spec.kind == "frequency"
                           else (extra["thd_percent"], "%"))
        else:
            h = s.transfer(spec)
            db = 20 * np.log10(np.maximum(np.abs(h), 1e-300))
            if spec.kind == "gain":
                sample = s.at(h, spec.frequency)
                if abs(sample) == 0:
                    raise EvidenceUnavailable("Zero transfer magnitude; dB gain is undefined")
                value, unit = float(20 * np.log10(abs(sample))), "dB"
                extra = {"linear": float(abs(sample)), "phase_deg": float(np.angle(sample, deg=True))}
            elif spec.kind == "bandwidth":
                ref_freq = spec.reference_frequency or float(s.axis[0])
                reference_db = float(s.at(db, ref_freq))
                idx = max(0, int(np.searchsorted(s.axis, ref_freq)) - 1)
                value, _, _ = crossing(s.axis, db, reference_db - spec.drop_db, idx)
                unit = "Hz"
                extra = {
                    "reference_frequency_hz": ref_freq,
                    "reference_gain_db": reference_db,
                    "definition": "Upper cutoff relative to declared passband reference; not band-pass width",
                }
            else:
                if not spec.loop_gain:
                    raise EvidenceUnavailable(
                        "Phase margin requires a loop-gain testbench with DC bias/loading preserved, not closed-loop gain"
                    )
                h = h * spec.loop_sign
                db = 20 * np.log10(np.maximum(np.abs(h), 1e-300))
                frequency, index, alpha = crossing(s.axis, db, 0)
                phase = np.unwrap(np.angle(h)) * 180 / np.pi
                value = float(180 + phase[index] + alpha * (phase[index + 1] - phase[index]))
                unit = "deg"
                extra = {
                    "unity_frequency_hz": frequency,
                    "definition": "First descending unity-loop-gain crossing; loop_sign establishes negative-feedback return ratio",
                }
        if np.iscomplexobj(value):
            extra.update(
                real=float(value.real),
                imaginary=float(value.imag),
                phase_deg=float(np.angle(value, deg=True)),
            )
            value = abs(value)
        if not np.isfinite(value):
            raise EvidenceUnavailable("Non-finite measurement")
        return {"name": spec.name, "status": "measured", "value": float(value), "unit": unit, **extra}
    except (ValueError, KeyError, TypeError, IndexError) as exc:
        return {"name": spec.name, "status": "unverified", "value": None, "reason": str(exc)}


def verify(circuit, raw, analysis, constraints: list[Constraint]) -> dict:
    results = []
    for constraint in constraints:
        evidence = measure(circuit, raw, analysis, constraint.measurement)
        if constraint.minimum is None and constraint.maximum is None and constraint.target is None:
            raise ValueError("Constraint needs minimum, maximum or target")
        if (
            constraint.minimum is not None
            and constraint.maximum is not None
            and constraint.minimum > constraint.maximum
        ):
            raise ValueError("Constraint minimum exceeds maximum")
        verdict = "unverified"
        if evidence["status"] == "measured":
            value = evidence["value"]
            passed = (constraint.minimum is None or value >= constraint.minimum) and (
                constraint.maximum is None or value <= constraint.maximum
            )
            if constraint.target is not None:
                tolerance = (
                    constraint.absolute_tolerance + abs(constraint.target) * constraint.relative_tolerance
                )
                passed &= abs(value - constraint.target) <= tolerance
            verdict = "pass" if passed else "fail"
        results.append({"constraint": constraint.model_dump(), "verdict": verdict, "evidence": evidence})
    overall = (
        "fail"
        if any(r["verdict"] == "fail" for r in results)
        else "unverified"
        if not results or any(r["verdict"] == "unverified" for r in results)
        else "pass"
    )
    return {"verdict": overall, "requirements": results}


def diagnose(circuit, verification=None, error=None) -> list[dict]:
    issues = []
    if error:
        text = error.lower()
        recommendation = "Inspect the retained netlist and simulator log, check model pins and source values"
        if "singular" in text or "floating" in text:
            recommendation = "Check ground and DC return paths; capacitors isolate DC nodes. Add physically justified bias/leakage paths"
        elif "timestep" in text or "converg" in text:
            recommendation = "Check bias, model discontinuities and switching edge times; add realistic parasitics before relaxing tolerances"
        issues.append(
            {"kind": "simulation_failure", "evidence": error[-3000:], "recommendation": recommendation}
        )
    for item in (verification or {}).get("requirements", []):
        if item["verdict"] == "pass":
            continue
        spec = item["constraint"]["measurement"]
        issue = {"kind": item["verdict"], "measurement": spec["name"], "evidence": item["evidence"]}
        if spec["kind"] == "bandwidth":
            node = node_name(spec["node"])
            capacitors = [
                c.id
                for c in circuit.components
                if c.type == "capacitor" and node in circuit.resolved_nodes()[c.id]
            ]
            issue.update(
                hypothesis="Output RC loading or insufficient active-device gain-bandwidth may limit the response",
                candidate_components=capacitors,
                recommendation="Sweep the output capacitance and source resistance independently; compare cutoff movement before attributing cause. For active stages check bias current and model GBW",
            )
        elif spec["kind"] == "gain":
            issue.update(
                hypothesis="Bias, loading or feedback ratio may reduce gain",
                recommendation="Check operating point, compare intended resistor ratios and load impedance, then rerun AC",
            )
        elif spec["kind"] == "noise":
            issue.update(
                recommendation="Check the integration band and model noise parameters; evaluate resistor thermal noise and input device noise contributions"
            )
        elif spec["kind"] == "phase_margin":
            issue.update(
                recommendation="Verify loop probe sign and loading, inspect all unity crossings, then sweep compensation capacitance"
            )
        else:
            issue.update(
                recommendation="Check stimulus, measurement window, pin order and operating point against the retained circuit"
            )
        issues.append(issue)
    return issues
