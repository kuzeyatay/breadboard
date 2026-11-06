# Breadboard-generated oscillator evidence

These files were copied from Breadboard Super Agent's accepted circuit run;
Codex did not substitute an external simulator design for this acceptance.

`circuit.json` is the native IR, `circuit.cir` its exported netlist, and
`analysis.json` the final settled-window analysis. `result.json` and `report.md`
hold measured constraints. `acceptance.json` also records startup, mute,
intermediate controls, AC filtering and limiter overdrive/recovery runs.

`manifest.json` is the original full-run manifest, preserved verbatim. This
repository directory includes only the small reviewable evidence files; the
large raw, all-vector CSV, and schematic exports remain in Breadboard's owning
conversation workspace and imported artifacts. Do not use this subset as if it
were a complete run directory for integrity checking.

Conversation: `conv_zj0F5EwODfSGQD3VApMwyZoX`; EC 2 chat 885.
Simulation: ngspice 42; ±12 V; 10 kΩ load; nominal 0–1 mW output.
The result verifies educational models, not physical hardware.

`presentation.json` records four native `plot_results` calls, eight PNG/CSV
imports, authenticated downloads before and after another desktop restart, the
saved final reply, and the corrected lab reader link. The original 51 files in
the three plotted runs still match their manifests after these derived exports.
`settled.png`, `startup.png`, `limiter.png` and `bode.png` are byte-for-byte copies
of Breadboard's selected plots; `settled.csv` and `bode.csv` hold their selected
samples. They are additional evidence, not entries in the original manifest.
