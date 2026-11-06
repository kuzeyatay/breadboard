"""Bounded, reproducible sweeps and optimization over real simulator evaluations."""

from __future__ import annotations

import itertools
import math
import time
import uuid
from typing import Literal

import numpy as np
from pydantic import Field, model_validator

from . import artifacts
from .backends import Analysis
from .circuit import Circuit, Record, number
from .measurements import Constraint, Measurement
from .service import atomic_json


class Variable(Record):
    component: str
    field: str = "value"
    minimum: float
    maximum: float
    scale: Literal["linear", "log"] = "log"

    @model_validator(mode="after")
    def ordered(self):
        if not self.minimum < self.maximum or self.scale == "log" and self.minimum <= 0:
            raise ValueError("Variable requires minimum < maximum and log bounds must be positive")
        return self


class Objective(Record):
    measurement: Measurement
    target: float
    scale: float = Field(default=1, gt=0)
    weight: float = Field(default=1, gt=0)


def changed(circuit, values):
    draft = circuit.model_dump()
    for key, value in values.items():
        ref, field = key.split(".", 1)
        circuit.component(ref)
        if field != "value" and not field.startswith("parameters."):
            raise ValueError("Sweep field must be value or parameters.<name>")
        for c in draft["components"]:
            if c["id"].lower() != ref.lower():
                continue
            if field == "value":
                if c["type"] not in {"resistor", "capacitor", "inductor", "voltage_source", "current_source"}:
                    raise ValueError(
                        "This device has no scalar value; sweep a named model-instance parameter"
                    )
                c["value"] = number(value)
            else:
                name = field.split(".", 1)[1]
                if name not in c["parameters"]:
                    raise ValueError(f"Declare {name} on the component before sweeping it")
                c["parameters"][name] = number(value)
    return Circuit.model_validate(draft)


def _start(service, circuit_id, mode, budget, timeout):
    if isinstance(budget, bool) or not 1 <= budget <= 100:
        raise ValueError("Study budget must be between 1 and 100 simulations")
    if not 0 < timeout <= 3600:
        raise ValueError("Study timeout must be between 0 and 3600 seconds")
    state = service.load_circuit(circuit_id)
    circuit = Circuit.model_validate(state["circuit"])
    study_id = uuid.uuid4().hex
    directory = service.path("studies", study_id)
    directory.mkdir()
    artifacts.json_write(directory / "baseline.json", state)
    result = {
        "study_id": study_id,
        "circuit_id": circuit_id,
        "baseline_revision": state["revision"],
        "mode": mode,
        "status": "running",
        "rows": [],
        "directory": str(directory),
    }
    atomic_json(directory / "summary.json", result)
    return circuit, result, directory, time.monotonic() + timeout


def _evaluate(service, base, analysis, values, measurements, constraints, result, directory, deadline):
    if time.monotonic() >= deadline:
        raise TimeoutError("Study time budget exhausted")
    if (directory / "cancel.requested").exists():
        raise InterruptedError("Study cancelled")
    circuit = changed(base, values)
    remaining = max(0.01, deadline - time.monotonic())
    bounded = analysis.model_copy(update={"timeout": min(analysis.timeout, remaining)})
    run = service.run_snapshot(
        circuit, bounded, measurements, constraints, result["circuit_id"], result["baseline_revision"]
    )
    row = {"parameters": values, **run}
    result["rows"].append(row)
    atomic_json(directory / "summary.json", result)
    return row


def _finish(result, directory):
    atomic_json(directory / "summary.json", result)
    artifacts.sweep_plot(result["rows"], directory)
    artifacts.manifest(directory, {"study_id": result["study_id"], "mode": result["mode"]})
    return result


def _fail(result, directory, error):
    result.update(status="failed", success=False, reason=str(error))
    _finish(result, directory)


def parameter_sweep(service, circuit_id, analysis, parameters, measurements=(), constraints=(), timeout=600):
    analysis = Analysis.model_validate(analysis)
    keys = list(parameters)
    if not keys or any(not isinstance(v, list) or not v for v in parameters.values()):
        raise ValueError("Supply parameter keys such as R1.value with nonempty value lists")
    count = math.prod(len(v) for v in parameters.values())
    circuit, result, directory, deadline = _start(service, circuit_id, "parameter_sweep", count, timeout)
    try:
        for combination in itertools.product(*parameters.values()):
            values = {key: number(value) for key, value in zip(keys, combination)}
            _evaluate(
                service, circuit, analysis, values, measurements, constraints, result, directory, deadline
            )
        result["status"] = "completed"
    except (TimeoutError, InterruptedError) as exc:
        result.update(status="stopped", reason=str(exc))
    except Exception as exc:
        _fail(result, directory, exc)
        raise
    return _finish(result, directory)


def monte_carlo_analysis(
    service,
    circuit_id,
    analysis,
    samples=30,
    seed=0,
    distribution="uniform",
    measurements=(),
    constraints=(),
    timeout=600,
):
    analysis = Analysis.model_validate(analysis)
    if distribution not in {"uniform", "normal"}:
        raise ValueError("Distribution must be uniform or normal (tolerance is 3 sigma)")
    circuit, result, directory, deadline = _start(service, circuit_id, "monte_carlo", samples, timeout)
    targets = [c for c in circuit.components if c.tolerance > 0]
    if not targets:
        error = ValueError("Declare nonzero tolerances on components before Monte Carlo")
        _fail(result, directory, error)
        raise error
    rng = np.random.default_rng(seed)
    result.update(seed=seed, distribution=distribution, normal_tolerance_convention="3 sigma, untruncated")
    try:
        for _ in range(samples):
            values = {
                c.id + ".value": number(c.value)
                * (
                    1
                    + (
                        rng.uniform(-c.tolerance, c.tolerance)
                        if distribution == "uniform"
                        else rng.normal(0, c.tolerance / 3)
                    )
                )
                for c in targets
            }
            _evaluate(
                service, circuit, analysis, values, measurements, constraints, result, directory, deadline
            )
        result["status"] = "completed"
    except (TimeoutError, InterruptedError) as exc:
        result.update(status="stopped", reason=str(exc))
    except Exception as exc:
        _fail(result, directory, exc)
        raise
    passes = sum(row.get("verification", {}).get("verdict") == "pass" for row in result["rows"])
    result.update(
        passed_samples=passes,
        completed_samples=len(result["rows"]),
        yield_fraction=passes / samples if constraints else None,
        yield_denominator=samples,
        requested_samples=samples,
    )
    return _finish(result, directory)


def optimize_values(
    service,
    circuit_id,
    analysis,
    variables,
    objectives,
    constraints=(),
    max_evaluations=30,
    seed=0,
    timeout=600,
):
    """Seeded bounded population search + coordinate refinement; final candidate is re-simulated."""
    analysis = Analysis.model_validate(analysis)
    variables = [Variable.model_validate(v) for v in variables]
    objectives = [Objective.model_validate(o) for o in objectives]
    constraints = [Constraint.model_validate(c) for c in constraints]
    if not variables or not objectives or max_evaluations < 4:
        raise ValueError("Optimization needs variables, objectives and at least 4 evaluations")
    keys = [v.component + "." + v.field for v in variables]
    if len({k.lower() for k in keys}) != len(keys):
        raise ValueError("Duplicate optimization variable")
    names = [o.measurement.name for o in objectives]
    if len(set(names)) != len(names):
        raise ValueError("Objective measurement names must be unique")
    circuit, result, directory, deadline = _start(
        service, circuit_id, "optimization", max_evaluations, timeout
    )
    result.update(
        seed=seed,
        variables=[v.model_dump() for v in variables],
        objectives=[o.model_dump() for o in objectives],
        constraints=[c.model_dump() for c in constraints],
    )
    rng = np.random.default_rng(seed)
    low = np.array([math.log(v.minimum) if v.scale == "log" else v.minimum for v in variables])
    high = np.array([math.log(v.maximum) if v.scale == "log" else v.maximum for v in variables])
    baseline_values = {}
    initial = []
    try:
        for v, key in zip(variables, keys):
            c = circuit.component(v.component)
            value = number(c.value if v.field == "value" else c.parameters[v.field.split(".", 1)[1]])
            baseline_values[key] = value
            initial.append(math.log(value) if v.scale == "log" else value)
        changed(circuit, baseline_values)
    except (ValueError, KeyError, IndexError) as exc:
        _fail(result, directory, exc)
        raise ValueError(f"Invalid optimization variable or initial value: {exc}") from exc
    best = None
    best_position = np.clip(initial, low, high)
    measurements = [o.measurement.model_dump() for o in objectives]

    def score(row):
        if not row["success"] or any(m["status"] != "measured" for m in row.get("measurements", [])):
            return math.inf
        if constraints and row["verification"]["verdict"] != "pass":
            return math.inf
        evidence = {m["name"]: m["value"] for m in row["measurements"]}
        return sum(o.weight * ((evidence[o.measurement.name] - o.target) / o.scale) ** 2 for o in objectives)

    try:
        for i in range(max_evaluations - 1):
            if i == 0:
                values, position = baseline_values, np.asarray(initial)
            else:
                if i == 1:
                    position = (low + high) / 2
                elif i % 3 == 0 or best is None:
                    position = rng.uniform(low, high)
                else:
                    position = best_position.copy()
                    axis = (i // 2) % len(variables)
                    radius = (high[axis] - low[axis]) * 0.5 ** (1 + i // max(4, 2 * len(variables)))
                    position[axis] += radius * (-1 if i % 2 else 1)
                    position = np.clip(position, low, high)
                values = {
                    key: float(math.exp(p) if v.scale == "log" else p)
                    for key, p, v in zip(keys, position, variables)
                }
            row = _evaluate(
                service,
                circuit,
                analysis,
                values,
                measurements,
                [c.model_dump() for c in constraints],
                result,
                directory,
                deadline,
            )
            loss = score(row)
            row["objective_loss"] = loss if math.isfinite(loss) else None
            # Baseline outside bounds is evidence only, never selected.
            in_bounds = all(v.minimum <= values[key] <= v.maximum for v, key in zip(variables, keys))
            if in_bounds and math.isfinite(loss) and (best is None or loss < best["objective_loss"]):
                best, best_position = row, position.copy()
        if best is not None:
            final = _evaluate(
                service,
                circuit,
                analysis,
                best["parameters"],
                measurements,
                [c.model_dump() for c in constraints],
                result,
                directory,
                deadline,
            )
            final_loss = score(final)
            if math.isfinite(final_loss):
                best_design = changed(circuit, best["parameters"])
                artifacts.json_write(directory / "optimized-circuit.json", best_design.model_dump())
                artifacts.schematic(best_design, directory)
                result.update(
                    best_parameters=best["parameters"],
                    objective_loss=final_loss,
                    verified_run_id=final["run_id"],
                    candidate_path=str(directory / "optimized-circuit.json"),
                )
            else:
                result["reason"] = "Best candidate failed independent re-verification"
        else:
            result["reason"] = "No feasible measured candidate within the declared budget"
        result["status"] = "completed"
    except (TimeoutError, InterruptedError) as exc:
        result.update(status="stopped", reason=str(exc))
    except Exception as exc:
        _fail(result, directory, exc)
        raise
    result["success"] = "verified_run_id" in result
    return _finish(result, directory)


def apply_optimized_values(service, study_id, expected_revision):
    directory = service.path("studies", study_id)
    from .service import read_json

    result = read_json(directory / "summary.json")
    if not result.get("success") or not result.get("verified_run_id"):
        raise ValueError("Study has no independently verified candidate")
    if expected_revision != result["baseline_revision"]:
        raise ValueError("Candidate is tied to a different baseline revision")
    candidate = Circuit.model_validate(read_json(directory / "optimized-circuit.json"))
    return service._edit(
        result["circuit_id"], lambda draft: draft.update(candidate.model_dump()), expected_revision
    )
