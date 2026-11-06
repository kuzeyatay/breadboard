# Diagnose circuit failures

Read the failed run's error, diagnostics and retained run.log. Simulation success
only means that valid data was produced; compare requirements separately. Do not
retry the same failing netlist without a concrete change.

Common checks:

- Missing model or unsupported syntax: verify name, pin order, declared parameters
  and simulator compatibility. Replace unavailable vendor models only with an
  explicitly labelled approximation and downgrade affected claims.
- Singular/floating node: inspect ground and DC return paths. Capacitors isolate DC
  nodes; a leakage resistor must represent a plausible physical path.
- Convergence/timestep failure: inspect bias, ideal loops, switching rise/fall times
  and model discontinuities. Add physical parasitics before relaxing tolerances.
- Wrong gain: inspect OP, source AC magnitude, output loading, bias and feedback ratio.
- Limited bandwidth: output capacitance, source resistance, device GBW and bias may
  contribute. Sweep one suspected variable and check the predicted cutoff movement.
- Poor phase margin: validate loop probe sign and bias/loading, inspect every unity
  crossing, and test compensation. Closed-loop gain is insufficient evidence.

Diagnostics are evidence-backed hypotheses, not a causal oracle. If a 20 kHz cutoff
misses a 100 kHz requirement and Cload is present, propose reducing Cload; confirm
the hypothesis by a controlled sweep. Do not assert “Cload caused this” solely from
the failed number.

Use expected_revision to prevent overwriting another edit. Compare old and new run
IDs against the same measurements, model set and stimulus. Stop after a bounded
number of corrections (choose a task-appropriate budget, typically 3–5 hypotheses)
and report remaining evidence gaps if none pass.
