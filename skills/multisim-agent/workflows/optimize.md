# Optimize a design

Start with a valid baseline and measurements. Declare hard constraints separately
from weighted objectives; specify each objective's target and scale so mixed units
do not accidentally dominate the score. Keep topology and model provenance fixed
during a value optimization unless the task explicitly calls for topology search.

`parameter_sweep` takes a Cartesian product, e.g.
`{"R1.value":[1000,2200,4700],"C1.value":[1e-9,2.2e-9]}`. It runs at most 100
candidates and writes per-run evidence plus sweep.csv, sweep.svg and sweep.png.
This is also a way to compare E-series candidates or validate a diagnostic hypothesis.

`monte_carlo_analysis` uses the nonzero tolerances on component values, an explicit
seed and a chosen distribution. Uniform uses ±tolerance; normal uses tolerance as
3 sigma, without truncation. Samples are independent; correlated process models
require a separately designed study. Failed/missing samples cannot count as passes.
Yield's denominator is the requested sample count; no constraints means unknown yield.

`optimize_values` takes:

```json
{
  "circuit_id":"<returned id>",
  "analysis":{"kind":"op"},
  "variables":[{"component":"R2","field":"value","minimum":10000,"maximum":30000,"scale":"linear"}],
  "objectives":[{"measurement":{"name":"vout","kind":"voltage","node":"vout"},"target":3.3,"scale":0.1}],
  "max_evaluations":24,
  "seed":0,
  "timeout":300
}
```

Variables target value or parameters.<declared name>. Log scale is appropriate for
positive values spanning orders of magnitude. The algorithm combines seeded
bounded exploration and coordinate refinement, includes the baseline and reserves
one simulation for a fresh final check. It is a budgeted search, not a guarantee
of a global optimum. If no feasible candidate is found, inspect the evidence before
changing bounds, constraints or topology. Optimization objective loss is not itself
a requirements pass; declare acceptable numeric limits as constraints.

The baseline is immutable during studies. A successful study supplies a verified
run ID and optimized-circuit.json. Apply only when useful to the requested task,
using apply_optimized_values(study_id, expected_revision). A stale baseline is refused.
Then validate additional operating conditions, startup, tolerance and model limits
appropriate to the design. A nominal improvement alone does not establish robustness.

get_study exposes progress and completed candidates; cancel_study stops before the
next candidate (an active simulation has its own timeout/cancel_run). The native
budget is 300 seconds; the standalone CLI supports longer bounded studies. If a
worker is externally killed, retain its artifacts and create a fresh study rather
than treating a partial summary as complete. The upstream compatibility server
additionally retains its own durable job/retry APIs.
