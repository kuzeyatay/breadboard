# Simulate and measure

Prefer `run_circuit_experiment` with analysis, measurements and constraints in one
request. It snapshots the exact circuit revision, runs the simulator, writes
SPICE3 raw/JSON/CSV, renders SVG/PNG, verifies requirements and writes a report
plus SHA-256 manifest. Convenience tools run_operating_point, run_dc_sweep,
run_ac_analysis, run_transient_analysis and run_noise_analysis use the same engine.
Native calls allow 300 seconds per study, at most 100 candidate runs; CLI studies
can explicitly extend the wall budget to 3600 seconds. One simulation is limited
to 300 seconds, point count and 256 MiB raw output. A missing simulator is an error.

Analysis examples (all numerical inputs are SI):

```json
{"kind":"op"}
{"kind":"dc","source":"V1","start":0,"stop":5,"step":0.1}
{"kind":"ac","start":10,"stop":10000000,"points":100,"scale":"dec"}
{"kind":"tran","start":0,"stop":0.01,"step":0.000001}
{"kind":"noise","source":"VIN","output":"vout","start":10,"stop":100000,"points":100}
```

DC sweep must advance toward stop. AC/noise need positive ordered frequencies.
Transient runs from time zero to establish state; start selects the retained window.
Set nonzero ac on the intended small-signal input source. Noise input must be an
independent source; supply sources normally have ac omitted. Sweep resolution must
resolve narrow resonances and feedback crossings. Do not decimate measurements.

Measurement examples:

```json
{"name":"dc_output","kind":"voltage","node":"vout"}
{"name":"gain_1k","kind":"gain","node":"vout","input_node":"vin","frequency":1000}
{"name":"upper_cutoff","kind":"bandwidth","node":"vout","input_node":"vin","reference_frequency":1000}
{"name":"ripple","kind":"voltage","node":"vout","statistic":"peak_to_peak","start":0.005,"stop":0.01}
{"name":"noise_rms","kind":"noise"}
```

Gain reports voltage ratio in dB, linear magnitude and phase. Bandwidth is the
first descending upper cutoff relative to a passband reference (default first
sweep frequency); it is not the full width of an arbitrary band-pass. A missing
crossing is unverified, not the last frequency. No frequency extrapolation occurs.

Voltage is differential. AC voltage/current needs frequency and returns magnitude,
real, imaginary and phase. Transient means and RMS use time-weighted integration
on adaptive samples. Use a settled window. Positive current flows from the first
terminal into the element. BJT current is collector current and MOS current is drain
current. For unsupported device branches use a zero-volt sense source. AC active-device
current may be unavailable; this remains unverified. Two-terminal power is absorbed
power; negative means delivered. AC uses 0.5 Re(V I*) for peak-amplitude phasors.

Noise without a frequency integrates squared output voltage spectral density across
the simulated band and takes the square root; with frequency it reports V/√Hz.
Phase margin only accepts an explicitly declared loop_gain testbench; loop_sign
sets the negative-feedback return-ratio convention. Inspect all crossings and do
not treat the first crossover alone as a general stability proof.

Constraints use a measurement plus minimum/maximum, or target with absolute_tolerance
and relative_tolerance. Missing evidence is unverified. Empty constraints do not pass.
For example:

```json
{"measurement":{"name":"gain","kind":"gain","node":"vout","input_node":"vin","frequency":1000},"target":20,"absolute_tolerance":0.5}
```

Use get_run/list_runs for status, cancel_run for active work, inspect_artifacts to
verify integrity, and plot_results(node pair) for a transfer Bode plot. Ordinary
plots show named voltages, noise density or transient waveforms. Preserve original
run artifacts; new plots are derived exports in a separate subdirectory.
For a readable transient, pass `output_node` and `start`/`stop` in seconds to
`plot_results`, for example a few settled cycles. `input_node` optionally adds a
comparison trace. Windows must stay inside the simulated range. Plot the startup
and limiter fault separately from the settled sine wave.
This also exports `plotted-data.csv` with every selected sample (complex data uses
real and imaginary columns). Use it when the all-vector CSV exceeds chat attachment
limits; do not loosen limits or relabel an oversized file. The original raw data
and manifest remain intact.

For oscillators, use a real feedback loop and a single startup impulse, not an
ideal periodic source. Measure `frequency` and `thd` in run_circuit_experiment
or call `measure_frequency` and `measure_distortion` afterwards. Both require
an explicit settled start/stop window containing at least five complete cycles.
THD is a percentage from a time-weighted harmonic fit (default harmonics 2–10),
excluding noise. Use a maximum timestep of 1 us or smaller at 10 kHz; finer steps
are needed for higher harmonic counts. Unsettled, undersampled, flat or short
waveforms return unverified. `measure_power` with component set to the actual
load resistor gives time-averaged load power; do not infer it from a peak sample.
Verify output-control settings with independent transient runs, and use a
separate overdrive testbench to establish the limiter's behavior.

At handoff, export the FINAL revision with `export_circuit_project`, import its
`.bbcir` and HTML as Breadboard artifacts, and verify the artifact IDs exist before
linking them. Keep the matching run IDs, revision/hash, startup and settled traces,
spectrum/THD, filter Bode response and control sweep. A connected picture proves
connectivity only, not measured performance. Do not count rewired test variants
as an adjustable control in the exported design. If the lab requires few op-amps,
report the component count and the topology tradeoff; if it requires real-device
simulation or bench measurements, ideal-model results cannot complete those items.
