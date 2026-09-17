---
name: interactive-visualizer
description: Generate one fast, bespoke, Gemini-style interactive simulation as a persistent artifact. Use when a prompt is better answered by manipulating a visual model, playing an animation, rotating a spatial object, or comparing a few live parameters.
---

# Interactive Visualizer

Create one prompt-specific coded interface as a persistent artifact. This is
generative UI, not a fixed scene template or a dashboard.

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - interactive_visualizer_create
    - interactive_visualizer_plan
    - interactive_visualizer_generate
    - interactive_visualizer_revise
    - interactive_visualizer_rollback
    - interactive_visualizer_cancel
  requiredArtifactKinds: [html]
  requiredRuntimes: [interactive-visualizer-runtime]
  requiredMcpServers: []
  optionalMcpServers: []

## Fast path

Call `interactive_visualizer_create` exactly once with the plan and finished
package together. Do not use the terminal, create temporary files, inspect the
repository, run manual tests, or call the legacy plan/generate pair. The tool
owns validation, bundling, browser testing, persistence, and publication.
If a still-running legacy host has not loaded that tool yet, use one plan call
followed immediately by one generate call with the schema-2 package and do no
work between them.

If it returns a precise repairable validation error, correct only that error
through the existing revision path. After a ready result, give one short
summary and point to the artifact. Do not paste source into chat.

## Gemini-style interface

- Design a unique interface for the requested concept.
- Use one concise H1, then a dominant Canvas, inline SVG, or supplied Three.js
  scene. Put circular play/pause and reset controls at the top right when useful.
- Use small inline SVGs for toolbar icons, never font glyphs or emoji. Play and
  pause must expose exactly one state icon at a time while updating both the
  accessible label and `aria-pressed` state.
- Use `data-action="play-pause"` and `data-action="reset"` for those controls.
- Put at most one thin result strip below the visual and only a few high-value
  controls after it.
- Use flat fills, thin separators, generous space, one blue accent, and compact
  monospaced numbers.
- Never use nested cards, sidebars, control-panel headings, gradients, shadows,
  glass effects, long instructional copy, status dashboards, or decorative
  badges.
- Fit roughly one desktop screen and adapt to resized desktop windows and
  artifact panes. Phone-size rendering is not a publication requirement.
- In CSS use the host tokens `--viz-bg`, `--viz-panel`, `--viz-control`,
  `--viz-control-hover`, `--viz-text`, `--viz-muted`, `--viz-line`,
  `--viz-accent`, and `--viz-accent-text`.
- Derive every DOM text color, surface, border, SVG fill, and SVG stroke from
  those tokens. Do not infer a theme from system preference. Canvas and WebGL
  drawing must read the current tokens and repaint on `breadboard:themechange`.
- Construct diagrams from shared named anchors. Intended connections must
  share exact endpoints; reject unintended gaps, overlaps, clipped labels, and
  floating mechanical, geometric, circuit, or causal elements.
- Include a `visual integrity` semantic test that covers contrast, clipping,
  label/control overlap, alignment, and connection continuity.

## Choose the dimension before the renderer

Flat interface styling does not mean a 2D scene. Do not default to 2D for
implementation ease. Decide from the requested explanation:

1. Honor an explicit 2D/3D request, cross-section, or planar approximation.
   Label a slice of a spatial concept and state what the simplification omits.
2. Use **3d** when enclosure, volume, depth, surface orientation, solid angle,
   or non-coplanar geometry is central. Use **2d** when a plane, diagram, or
   graph fully expresses the requested relationship. Ask what a flat view
   would hide; topic names and variable counts alone do not decide the mode.
3. Use **hybrid** for a spatial scene with a linked 2D slice or plot only when
   both views add explanatory value. They must share a model. A numeric
   readout alongside a 3D scene does not make it hybrid.
4. State the deciding relationship in `plan.rationale`, record dimensional
   simplifications in `assumptions` and `limitations`, and match
   `manifest.mode` to the plan.

For example, Gauss's law with enclosed charge, closed Gaussian surfaces, or
surface flux calls for **3d**: show the enclosed volume, spatial field, and
outward normals. A circle alone is only a slice. An explicitly requested
equatorial section is **2d**, labelled as a section; a graph of total flux
versus charge is also **2d**. A cutting plane through a solid alongside its
linked cross-section calls for **hybrid**. Circuit schematics, time traces,
and planar waves generally call for **2d**.

Then choose SVG for labelled geometry, Canvas for animation/dense plots, or
the supplied global `THREE` for spatial scenes. Projected 3D in SVG/Canvas is
valid if it models real x/y/z geometry; a tilted flat drawing is not enough.
Make depth inspectable with rotate/orbit and zoom plus a keyboard-accessible
alternative. Derive the scene and measurements from the same model. Include
a semantic test of the key invariant: for Gauss's law, camera rotation must
not change enclosed charge or flux, and an external charge must not change
net flux through the closed surface.

## Schema-2 package

Send `schemaVersion: 2`, a matching schema-2 manifest, `assets: []`, and exactly
`index.html`, `styles.css`, and `main.js`. The manifest runtime is
`{ id: "breadboard-interactive-visualizer", version: "2.0.0" }`; add
`threeVersion: "0.185.1"` exactly when JavaScript references the supplied
`THREE` global. The mode describes the representation, not the rendering API:
projected 3D SVG/Canvas uses `mode: "3d"` without `threeVersion`.

HTML requires a semantic `#app`, one visible H1, a primary Canvas or inline SVG,
native labelled controls, and exactly `<script src="main.js"></script>`. CSS is
prompt-specific, responsive, network-free, flat, and uses the host tokens.
JavaScript implements the actual behavior with DOM/SVG/Canvas APIs,
`requestAnimationFrame`, pointer/keyboard events, ResizeObserver, and optional
global `THREE`.

Animated work must respect `prefers-reduced-motion`, pause while hidden, expose
play/pause, and reset to a useful initial state. Keep calculations finite and
bounded.

The sandbox forbids network access, URLs, navigation, storage, workers, eval,
dynamic imports, forms, nested frames, device capabilities, host messaging, and
prototype modification.

For a revision, reuse the artifact id and send a complete schema-2 package to
`interactive_visualizer_revise`. Reconsider the mode when the requested
explanation changes. Implement a requested 2D/3D/linked view in the replacement
package, set its `manifest.mode`, and describe the change and reason in
`revisionPrompt`. The service stages the matching plan and saves it only on
successful publication; do not retain a stale mode from the original plan.
Failed revisions preserve the active version. Use rollback only for validated
versions and cancel when requested.
