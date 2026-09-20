---
name: interactive-visualizer-in-chat
description: Generate one fast, bespoke, Gemini-style interactive simulation directly inside the response. Use when a prompt is better answered by manipulating a visual model, playing an animation, rotating a spatial object, or comparing a few live parameters.
---

# Interactive Visualizer in Chat

Create one prompt-specific coded interface and publish that same artifact inline
and in Artifacts. This is generative UI, not a dashboard template. The visual
must feel designed for the exact concept in the request.

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
package together. Do not use the terminal, write temporary files, inspect the
repository, run a browser manually, or call the old plan/generate pair. The
tool validates, bundles, browser-tests, persists, and publishes the result.
If a still-running legacy host has not loaded that tool yet, use one
`interactive_visualizer_plan` call followed immediately by one
`interactive_visualizer_generate` call with the same schema-2 package; do not
do any work between those calls.

Generate the complete interface in that single pass. If the tool returns a
specific repairable validation error, correct only that error and use the
existing artifact revision path. Do not redesign an accepted package during a
repair.

After publication, write at most one short lead-in sentence. Do not repeat the
title or describe implementation details; the visual follows automatically.

## Visual contract

Match Gemini's in-chat simulations:

- Build a unique interface for the concept, not a reusable control dashboard.
- Put one concise H1 at the top and the main Canvas, SVG, or Three.js scene
  immediately below it. The visual is the largest element.
- For motion, put a circular play/pause control and an optional reset control at
  the top right. Use small inline SVG icons, `data-action="play-pause"`, and
  `data-action="reset"`. Play and pause are mutually exclusive states: expose
  exactly one icon at a time, update `aria-label`, and update `aria-pressed`.
- Put at most one thin result strip below the scene, then only the few controls
  that materially change the explanation.
- Use flat surfaces, thin separators, generous empty space, a single blue
  accent, and compact monospaced numeric readouts.
- Do not use cards inside cards, sidebars, control-panel headings, gradients,
  shadows, glass effects, illustrations, long help copy, status dashboards, or
  decorative badges.
- Aim for one screen: approximately 700-900 CSS pixels tall on desktop. Adapt
  to the available chat or artifact pane without horizontal overflow.
  The chat owns scrolling: never require scrolling inside the visualizer or a
  nested control panel. Use natural content height, wrapping controls, and a
  compact scene; do not constrain the app with fixed/viewport heights,
  max-height, or overflow:auto/scroll. All controls must remain reachable when
  the host expands the frame to its content, including after state changes.
  Phone-size rendering is not a publication requirement.
- Use the host tokens `--viz-bg`, `--viz-panel`, `--viz-control`,
  `--viz-control-hover`, `--viz-text`, `--viz-muted`, `--viz-line`,
  `--viz-accent`, and `--viz-accent-text` so light and dark mode match chat.
- Every DOM text color, surface, border, SVG fill, and SVG stroke must derive
  from those host tokens. Never choose a theme from system preference in the
  generated app. Canvas drawing must read the current tokens with
  `getComputedStyle` and redraw after a host theme change.
- Build diagrams from shared named anchors. Elements that are physically or
  causally connected must share the exact same endpoint; do not eyeball
  independent segments or leave unintended gaps, overlaps, or floating parts.
- Include a `visual integrity` semantic test covering contrast, clipping,
  label/control overlap, alignment, and the continuity of every intended
  connection. Treat this as a release check, not descriptive filler.

## Choose 2D, 3D, or hybrid before the renderer

Make this decision in the plan before writing the package. Flat interface
styling does not mean a 2D scene. Do not default to 2D for implementation ease.

1. Honor the user's requested dimension, view, or simplification. An explicit
   cross-section or planar approximation can be 2D even for a spatial concept;
   label the slice and what it omits. A request to make an existing visual 3D
   is a change of representation, not just styling.
2. Identify what the user needs to understand. Choose **3d** when enclosure,
   volume, depth, surface orientation, solid angle, or non-coplanar geometry
   is central. Choose **2d** when a plane, diagram, or graph fully expresses
   the requested relationship. Judge the question, not just the topic name or
   the number of variables. For mixed signals, ask what a flat view would hide.
3. Choose **hybrid** only when a spatial scene and a linked 2D slice or plot
   together explain something neither view explains alone. Keep one shared
   model and one dominant scene; an ordinary numeric readout is not hybrid.
4. In `plan.rationale`, briefly name the deciding geometric relationship and
   why the chosen view preserves it. Record any dimensional simplification in
   `assumptions` and `limitations`. Set `manifest.mode` to the same choice.

Examples of applying the decision:

| Requested explanation | Mode and reason |
| --- | --- |
| Gauss's law: charges inside/outside a Gaussian surface, or equal charge and different enclosing shapes | **3d**: show a closed surface enclosing a volume, the spatial field, and outward normals. A circle is only a slice of that surface. |
| An equatorial cross-section of a Gaussian sphere | **2d**: the user requested a slice; label it and retain the full-surface meaning of total flux. |
| Total electric flux versus enclosed charge | **2d**: the requested scalar relationship is fully expressed by a graph. |
| How a plane cuts a solid, with the resulting cross-section alongside | **hybrid**: link the 3D solid and cutting plane to the 2D section. |
| A circuit schematic, time trace, or planar wave | **2d**: extra depth would not explain the requested relationship. |

Then choose SVG for crisp labelled geometry, Canvas for animation and dense
plots, or the supplied global `THREE` for a spatial scene. Projected 3D in
SVG/Canvas is also valid when it models real x/y/z geometry. A `3d` label,
perspective styling, or a tilted 2D drawing does not make a spatial model.
Make spatial relationships inspectable with rotate/orbit and zoom controls,
including a keyboard-accessible alternative. Derive scene, measurements,
and any linked slice from the same model. For Gauss's law, rotating the view
must not change enclosed charge or flux, and an external charge must not
change net flux through the closed surface. Include a semantic test of the
representation's key invariant, not only that the scene renders.

Hovering a zoomable visualizer and turning the scroll wheel must zoom its scene.
Use a labelled native zoom range with `data-visualizer-zoom`, or buttons with
`data-action="zoom-in"` and `data-action="zoom-out"`; the shared runtime connects
wheel input to these same controls in chat, Artifacts, and Learn pages. Keep the
zoom value, bounds, reset, and keyboard controls synchronized. Mark an inverse
camera-distance range with `data-zoom-direction="inverse"`. A bespoke camera
wheel handler may handle the event and call `preventDefault()` to take priority.
Preserve touch scrolling and browser Ctrl/Cmd-wheel zoom.

## Teaching difficult concepts

Make the mechanism visible: show a field evolving, vectors combining, a wave
propagating, a geometric construction unfolding, or a numerical method
converging. Each control must change the main scene in a way that answers the
learner's question. A dropdown that changes only a label or paragraph is not a
useful interactive explanation. Avoid decorative motion and spinning objects
whose rotation explains nothing.

Use animation when time, a process, or a continuous parameter explains the
concept. For a static concept, label any animated probe or construction as an
explanatory sweep rather than physical motion. Keep equations and readouts tied
to the actual geometry and state. Expose a useful default, a contrasting case,
and a visible limiting case; label any normalization or approximation.

The Learn generator reuses this exact skill and schema-2 package through its
garden publication adapter. It preserves the lesson, references and visual ID,
and replaces only the versioned visual artifact after compiler, real animation
and control tests, and source-aware critique. Learn simulations include working
Play/Pause and Reset; Reset restores the initial state and pauses. The adapter
returns the package to the host instead of making a chat artifact tool call.

## Package contract

Submit schema version 2 with no assets and exactly three files:

```text
{
  schemaVersion: 2,
  manifest: {
    schemaVersion: 2,
    artifactType: "interactive-visualizer",
    title, description, accessibilityDescription,
    mode: "2d" | "3d" | "hybrid",
    entry: "index.html",
    runtime: {
      id: "breadboard-interactive-visualizer",
      version: "2.0.0",
      threeVersion?: "0.185.1"
    }
  },
  assumptions: string[],
  limitations: string[],
  sourceReferences: [{ label, url?, gardenSlug? }],
  semanticTests: [{ name, assertion }],
  assets: [],
  files: { "index.html": string, "styles.css": string, "main.js": string }
}
```

`index.html` is semantic markup with one `#app`, one visible `h1`, a primary
`canvas` or inline `svg`, native labelled controls, and exactly
`<script src="main.js"></script>`. It may include exactly
`<link rel="stylesheet" href="styles.css">`; publication inlines that local
stylesheet and removes the link. Put no inline handlers or scripts in HTML.

`styles.css` owns the prompt-specific layout. It must be responsive and may use
the host tokens above. Flat fills only: the publication gate rejects shadows,
gradients, imports, and URLs.

`main.js` owns the real interaction and may use DOM APIs, SVG, Canvas 2D,
`requestAnimationFrame`, pointer/keyboard events, ResizeObserver, and the
supplied global `THREE`. Keep physics and geometry finite and deterministic.
The manifest `mode` describes the concept being shown, not the rendering API:
a projected 3D SVG remains `mode: "3d"` and omits `runtime.threeVersion`.
Include `threeVersion: "0.185.1"` exactly when `main.js` references the supplied
`THREE` global; that opt-in loads Three.js and enables the WebGL release gate.
Use `matchMedia("(prefers-reduced-motion: reduce)")` to start motion paused for
reduced-motion users. Pause work while the document is hidden. Listen for the
`breadboard:themechange` event and repaint any Canvas or WebGL scene from the
current host tokens.

## Boundaries

The mini-app is offline and runs in an opaque sandbox. Never use network calls,
external URLs, navigation, storage, workers, eval, dynamic imports, forms,
nested frames, browser/device capabilities, host messaging, or prototype
modification. Do not invent citations. Use source references only when the
answer actually relies on them.

For revisions, reuse the artifact id and send a complete schema-2 replacement
package to `interactive_visualizer_revise`. Reconsider the mode when the
requested explanation changes. When the user asks for 2D, 3D, or a linked view,
implement that representation, set the replacement `manifest.mode`, and state
the change and reason in `revisionPrompt`. The service stages the revised plan
with that mode and saves it only after successful publication; do not keep the
old mode to satisfy a stale plan. A failed revision must preserve the last
ready version. Use rollback only for a previously validated version and cancel
when the user asks to stop.
