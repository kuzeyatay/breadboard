---
name: multisim-agent
description: Design, simulate, debug and optimize electronic circuits, amplifiers, RC filters, voltage dividers and MOSFET switching stages. Measure gain, bandwidth, noise and stability using real ngspice or optional licensed NI Multisim, with schematics and reproducible results.
---

# Multisim Agent

breadboard:
  category: prebuilt
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools: [multisim]
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

Use Breadboard's native `multisim` tool with `action` and `arguments`. This runs
the same Python operations exposed individually by the optional MCP server.
If Hermes exposes only `tool_search`, `tool_describe` and `tool_call`, Multisim is
deferred. Search for `multisim`, describe it, then call `tool_call` with this exact
two-level envelope:

```json
{"name":"multisim","arguments":{"action":"runtime_status","arguments":{}}}
{"name":"multisim","arguments":{"action":"read_reference","arguments":{"name":"design"}}}
```

Keep `name:"multisim"` at the outer level for EVERY deferred call; its operation
and operation arguments go inside that outer `arguments` object. The remaining
examples below show the inner Multisim arguments. Use them directly only when
`multisim` itself is available in your model-facing tool list. A `tool_call`
error about a missing `name` is a wrapper error, not a simulator outage: correct
the envelope, rather than declaring the native simulator unavailable.

Start with `{"action":"runtime_status"}`. For an operation's exact arguments,
call `{"action":"describe_tool","arguments":{"name":"create_circuit"}}`.
Every native call keeps the operation inside `action` and its fields inside
`arguments`, for example `{"action":"create_circuit","arguments":{"circuit":{...}}}`.
Do not send a circuit directly as the tool's top-level arguments.
The service persists circuit revisions and runs in this conversation's workspace.
Keep the returned circuit_id, revision, run_id and study_id; never invent IDs.

In Super Agent mode, use this skill for ordinary circuit requests such as
“Create a low-noise amplifier with 20 dB gain” or “Build an RC low-pass filter”.
The user does not need to name Multisim or enter a slash command. Execute the
native tool calls in the current conversation; do not use `agent_launch` or
create a separate agent card for this skill. Show progress through the normal
thinking activity and return measurements, plots and artifact links in your reply.

The host agent supplies the reasoning loop: requirements → topology → circuit →
simulation → measurements → verification → bounded revision. The service supplies
validated editing and real simulator evidence. There is no model-provider API
key, hardcoded natural-language topology parser or analytic fallback simulator.

Before creating a circuit, call `{"action":"read_reference","arguments":{"name":"design"}}`.
Before simulating, read `simulate` the same way. These native references are
available in Super Agent chat; `skill_open` alone only loads this main page.
Read `debug` after a simulation failure and `optimize` when revising values.
The corresponding source files are:

- [Design](workflows/design.md): requirements, topology, models, pin order and IR.
- [Simulate](workflows/simulate.md): bias, AC, transient, noise, measurement semantics and artifacts.
- [Debug](workflows/debug.md): simulation failures, hypotheses and controlled revisions.
- [Optimize](workflows/optimize.md): candidate budgets, sweeps, tolerances, constraints and final verification.

Use [examples](examples/) as editable starting circuits: divider.json,
rc-filter.json, transistor-amplifier.json, opamp-amplifier.json and mosfet-switch.json.
They are educational models, not qualified commercial devices.
Read an example with `read_reference`, using its basename without `.json`.

Essential input rules: op amp IDs start with X and their nodes are ordered
`[non_inverting, inverting, positive_supply, negative_supply, output]`. A unity
buffer is `[input, output, vcc, vee, output]`. Current-source IDs start with I.
Put a source's numeric DC level in `value` and its PWL/PULSE/SIN expression in
`waveform`. Submit a complete circuit in one create_circuit call when the topology
is known; use component edits for subsequent revisions. Read returned errors and
the schema before retrying; do not repeat a malformed request.

For a request such as “a low-noise amplifier with 20 dB gain”, capture or explicitly
assume the signal band, source impedance, supply, input amplitude, load and numeric
noise requirement. The built-in op amp cannot establish a real low-noise claim:
it has no intrinsic noise, slew or output-current limit. Use a sourced device
model with verified pins and noise parameters, or report those requirements as
unverified. Never infer stability from closed-loop gain; phase margin requires
a separate loop-gain testbench that preserves bias and loading.

Routine local simulation and reversible edits are authorized by a circuit-design
request. Use expected_revision when editing an existing design. Keep hard constraints
separate from optimization objectives. Bound optimization by simulations and time,
stop when evidence meets the requirements or the declared budget is exhausted,
and explain unresolved failures without claiming success.

For a lab, read the actual assignment before designing. Separate its requirements
from additional user preferences and your own test assumptions. Minimize component
counts when requested; simulation alone does not establish hardware completion.

For requested LTspice or NI Multisim files, read the `exports` reference and use
`export_ltspice` (.asc and companion files) or `export_multisim` (native .ms14).
Check runtime_status.exporters first. Deliver the returned ZIP so required models
and symbols remain together. Never substitute a picture or renamed netlist for
these native formats. Report the returned verification scope and any limitations.

Deliver a real circuit, not only prose or a picture: call `export_circuit_project`.
It returns a portable `.bbcir` project containing the editable circuit, inline
models, SPICE and connected layout, plus SVG/PNG/HTML. Check `connected` and review
the component counts and unused-terminal warnings. Never call a component atlas
or an ASCII sketch a finished wired schematic. Export does not certify simulation.
Import BOTH `project_path` and `view_path` with Breadboard's `artifact_import`,
using exactly the returned paths. The HTML is viewable even on older app builds
and embeds the project data; download the separate .bbcir artifact to reopen it. Use returned artifact IDs/URLs in
the answer; if a call times out, inspect the artifact list before retrying or
claiming nothing was saved. Deliver the actual report, netlist, plots and CSV too.
Check `inspect_artifacts` for simulation evidence. Preserve model provenance,
assumptions and measured/unverified distinctions. Reopen a project with
`import_circuit_project` to create a new editable circuit without changing the old one.
