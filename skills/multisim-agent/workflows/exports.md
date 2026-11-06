# Export to LTspice and NI Multisim

Use `runtime_status` to inspect `exporters.ltspice` and `exporters.multisim`.
These exports are separate from the simulation backend: an ngspice design can be
exported to either application. Native exports do not run a simulation.

For LTspice, call `export_ltspice` with the existing `circuit_id` and optionally an
`analysis` (same typed schema as simulation). It returns a real `.asc`, companion
symbols and `models.lib` when needed. Import and deliver `bundle_path` as well as
the schematic. Extract the entire ZIP into one folder before opening `circuit.asc`.
A standalone ASC can lose custom symbols or model includes. Weave places and
wires symbols; Breadboard preserves pin order, parameters, waveforms and net names.

For Multisim, call `export_multisim` with `circuit_id`. It returns an actual binary
`.ms14` created by the multisim-mcp builder and electronics-workbench encoder.
Deliver `schematic_path` and `bundle_path` through `artifact_import`. Do not rename
`.bbcir`, SPICE or XML to `.ms14`. Unsupported devices, model expansion failures
and invalid layouts stop export. Expandable subcircuits may appear as editable
primitive components instead of one IC symbol.
The current Multisim builder requires 27 C and rejects instance parameters on
passive components and independent sources, which it cannot preserve.

Read `verification` and `warnings`. A verified codec round trip or layout does
not mean Multisim opened the file or simulated it. Sample-based local templates
explicitly report unverified application compatibility. Do not claim success
when an exporter or its NI component pack is unavailable.

Each export retains `design.json`, original `design.cir`, and `manifest.json` with
hashes, circuit revision, engine provenance and verification scope. Native exports
never replace the existing Breadboard project or simulation artifacts.
