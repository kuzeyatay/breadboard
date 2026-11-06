# Connected circuit project and EC2 lab audit

Verified 2026-10-03 against Breadboard's **10 kHz oscillator simulation** chat
(legacy chat 885, conversation `conv_zj0F5EwODfSGQD3VApMwyZoX`). The existing app
was kept running; no build, restart or process termination was performed.

## What the assignment actually requires

The original **5ECE0_LAB.pdf**, page 4 (the imported `ec-2/sources/5ece0-lab.md`
and its rendered page image were inspected), asks for a 10 kHz oscillator with
minimal harmonic distortion, adjustable amplitude, and as few op-amps and
potentiometers as possible. It requires simulation and measurement in the time
domain, frequency/spectrum domain, and frequency-response/Bode domain.

Pages 24–27 describe design, simulation, physical build/adjustment, measurement
and documentation; they recommend testing small blocks, moving from ideal to
specific devices, and then testing the integrated system. The submission is a
Canvas quiz with a video, rather than a separate report. No submission was made.

The 10 kΩ load and 0–1 mW output range came from the user's additional request.
±12 V supplies, ±1% frequency and THD below 1% were engineering/test assumptions,
not limits quoted from page 4. Those distinctions must survive future lab reports.

## Findings in the saved design

Circuit `7703721e307045099c13bc08ffe508df`, revision 16, has 46 components:
19 resistors, 7 capacitors, 12 op-amps, 4 diodes, 3 voltage sources and one
potentiometer subcircuit. The final XOUT input is `top`; `wiper` has only one
external terminal. Earlier control tests rewired the input between `top`,
`wiper` and ground. The final circuit contains no selector implementing that
rewiring. Consequently those tests do not verify a single user-adjustable final
circuit. The op-amp count also has not been minimized against the assignment.

The original PNG exporter was a component atlas. Matching net labels encoded
connectivity, but no signal wires were drawn. The earlier replacement HTML
artifact actually reached ready status even though the chat reported a timeout.
Raw JSON/netlist downloads did not provide a reopenable graphical circuit.

## Changes and live evidence

`export_circuit_project` / `render_schematic` now derive a `.bbcir` project,
SPICE deck, editable JSON, connected SVG/PNG and static HTML from one circuit IR.
The project embeds models, circuit hash, netlist, placements and orthogonal wires.
Ground/static supply labels are common; different signal nets never share wire
segments. All signal terminals are covered in the connectivity regression tests.
The browser rejects mismatched or missing endpoints/connections and supports
viewing, tracing, moving/rotating symbols and saving/reopening the project layout.
Electrical edits remain native agent-tool operations. This is a Breadboard format,
not an NI Multisim file or a claim of NI binary-format compatibility.

A prompt submitted through the actual chat's composer invoked native Multisim,
exported revision 16 and imported two artifacts. Its final response linked both
and explicitly warned about the unused wiper and ideal models. The circuit was
not edited and its old simulation claims were not recertified.

- Connected drawing: `art_96369d48-fe28-4668-a8fc-6f8fbe4e5ad8`, HTML, ready.
  Version 2 was saved through Breadboard's authenticated artifact editor endpoint
  to remove JavaScript-only download controls from the sandboxed preview and add
  the design review. The static preview has zero executable scripts.
- Circuit file: `art_325e88e5-6c0f-443c-aba6-dbb5f51ea0cb`, `.bbcir`, ready.
- The actual Breadboard artifact frame displayed all 46 component groups and
  58 routed signal connections (116 SVG polylines including crossing halos).
- The actual application was left displaying the connected schematic.
- Circuit state/revision and simulation evidence remained unchanged.

The current running frontend recognizes the HTML and downloads the project.
The new interactive `.bbcir` pane and in-chat link interception require the next
frontend build/restart, deferred under the user's explicit keep-running request.
The editable Python installation already provides the native export operations.

## Verification

- Python circuit suite: 79 passed with real ngspice required; after adding the
  render-failure recovery case, all 8 focused schematic tests passed. The suite
  includes divider, RC response, transistor/op-amp amplifiers and MOSFET switching,
  measurement/optimization, MCP and native contracts.
- Browser/parser/import/project/chat-link tests: 14 passed, including actual
  artifact-pane rendering, drag/rotate, SVG export and saved-project reopening.
- Native route, broker and Super Agent integration tests: 16 passed, including
  authenticated real-ngspice calls and absence of a separate Multisim agent card.
- Existing real Markdown regression tests: 35 passed.
- Desktop TypeScript check, Python Ruff and targeted viewer ESLint passed.

Hardware construction, myDAQ measurements, manufacturer-device qualification,
component-count optimization and the final amplitude-control correction remain
unverified. Export completion is not lab completion.

Local copies of the actual exported files are included here as `circuit.bbcir`,
`design.cir`, `design.json`, `schematic.svg`, `schematic.html` and `schematic.png`.
