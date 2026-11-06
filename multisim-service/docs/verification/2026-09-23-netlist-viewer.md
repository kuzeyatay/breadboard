# SPICE artifact viewer verification — 23 September 2026

Breadboard now recognizes `.cir`, `.ckt`, `.sp`, `.spice` and `.net` uploads and
produced files. The artifact pane lazily loads a native React/SVG adaptation of
f18m/netlist-viewer. Upstream commit, source files, licensing notices, architecture
mapping and supported syntax are retained in
[`dashboard/src/vendor/netlist-viewer`](../../../dashboard/src/vendor/netlist-viewer/README.md).

The existing **Verified oscillator SPICE netlist** artifact was retrieved through
the running Breadboard application's conversation-scoped artifact endpoint (HTTP
200). It is still stored as `binary-file` with `previewAvailable: false`. The new
viewer recognizes its filename and uses its authorized download endpoint. The
document parses without diagnostics: 46 top-level components, the two-resistor
POT100K subcircuit, and the four-component BB_OPAMP subcircuit. The saved deck's
transient command starts at zero; the earlier verification fixture starts saving
at 14 ms. Both control blocks are excluded from schematic connectivity.

Validation:

- Parser/import tests cover the actual oscillator design, four upstream decks,
  expression preservation, continuation lines, case-insensitive names, model
  polarity, optional substrate terminals, controlled sources, subcircuit parameters,
  malformed input, limits and all five file extensions.
- The browser test mounts the real ArtifactViewer and netlist viewer. It verifies
  legacy download-only artifacts and new preview artifacts, conversation-scoped
  URLs, net tracing, subcircuit navigation, component dragging/rotation, zoom/fit,
  source fidelity, SVG export, narrow/dark layouts, diagnostics and fetch retry.
  Unrelated document/CAD/media editors are stubbed in this browser fixture.
- All 10 viewer tests pass. The nine produced-artifact regressions pass when run
  separately; one combined repeat encountered a temporary-workspace `ENOENT` in
  the existing large-folder fixture, which passed on the standalone rerun. One
  separately run, existing
  `artifact-panel-controls.test.mjs` assertion expects attachment buttons that the
  current archive no longer has; that file and archive behavior were not changed.
- ESLint for the new viewer files and `tsc --project tsconfig.desktop.json --noEmit`
  pass. The broad base TypeScript configuration includes unrelated runtime-v2
  vendored projects and is not the desktop build's configuration.

Run from `dashboard`:

```sh
node --experimental-strip-types --test tests/netlist-viewer.test.mjs tests/netlist-viewer-ui.test.mjs tests/produced-artifacts.test.mjs
npx eslint src/lib/netlist-viewer src/app/components/hermes/artifact-netlist-viewer.tsx src/app/components/hermes/netlist-symbol.tsx
node --max-old-space-size=8192 node_modules/typescript/bin/tsc --project tsconfig.desktop.json --noEmit
```

**Installation is deferred at the user's request.** Breadboard was kept running;
the production dashboard was not rebuilt or replaced. The native viewer can be
checked in the running desktop after an authorized rebuild/restart. No claim is
made that the currently running production window has loaded the new component.
