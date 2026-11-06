# netlist-viewer in Breadboard

Upstream: https://github.com/f18m/netlist-viewer

Pinned commit: `35b37128c0dc844e1acf816c9528340498d9836a`.

The upstream application is a wxWidgets / Boost C++ desktop program, not a web
widget. Breadboard adapts its SPICE parser, circuit/device/pin data model,
non-overlapping placement, colored airwires, ground marks and device symbols to
TypeScript and React/SVG. It does not spawn another application. The corresponding
original source files are retained in `upstream/` for traceability.

Upstream's root LICENSE is MIT (Francesco Montorsi, 2010), retained alongside
this file. Older source headers refer to GPL; those headers and upstream's
`gnugpl.txt` are retained without alteration. This is an adaptation, not an
unmodified build or an upstream-maintained browser package.

| Upstream | Breadboard |
| --- | --- |
| `svParserSPICE`, `svCircuit`, `svBaseDevice` | `lib/netlist-viewer/model.ts` |
| `SVPA_PLACE_NON_OVERLAPPED`, `buildGraph` / colored airwires | `lib/netlist-viewer/layout.ts` |
| `devices.h` drawing primitives | `app/components/hermes/netlist-symbol.tsx` |
| wxWidgets canvas, drag / rotate / zoom | `artifact-netlist-viewer.tsx` and its CSS module |

Breadboard also handles top-level decks, continuation lines, model polarity,
four-terminal MOSFETs, behavioral sources, hierarchical subcircuits and control
blocks. Parameter expressions remain verbatim. Includes and commands never
execute. Unknown constructs produce diagnostics, not invented connections.

Open a `.cir`, `.ckt`, `.sp`, `.spice` or `.net` artifact to inspect its circuit,
select a net, move or rotate symbols, zoom, open a subcircuit, read source or export
SVG. File uploads and generated file imports use the same format registration.
Previously saved generic-download artifacts are recognized by filename and read
through their existing authorized download endpoint; no migration is needed.

The connections are airwires, as in upstream, not an electrical CAD autorouter.
Crossing lines do not create junctions. Only pin net names define connectivity;
SPICE ground is node `0`. This viewer does not validate or simulate a design.
External subcircuits remain labeled blocks. Coupled-inductor K cards are not
drawn. Conditional directives and net alias directives warn that connectivity
may differ. Viewer limits: 2 MiB, 2000 components, 128 pins per component.

Regression fixtures include upstream's four test decks and Breadboard's actual
10 kHz oscillator. Run `node --experimental-strip-types --test
tests/netlist-viewer.test.mjs tests/netlist-viewer-ui.test.mjs` in `dashboard`.
