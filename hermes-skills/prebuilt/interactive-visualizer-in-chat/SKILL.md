---
name: interactive-visualizer-in-chat
description: Generate one fast, bespoke, Gemini-style interactive simulation directly inside the response. Use when a prompt is better answered by manipulating a visual model, playing an animation, rotating a spatial object, or comparing a few live parameters.
---

# Interactive Visualizer in Chat

Create one prompt-specific coded interface and publish that same artifact inline
and in Artifacts. This is generative UI, not a dashboard template. The visual
must feel designed for the exact concept in the request.

breadboard:
  category: prebuilt
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
- Aim for one screen: approximately 700-900 CSS pixels tall on desktop. Stack
  cleanly at 375 CSS pixels without horizontal overflow.
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

Choose the representation that best explains the prompt. Use SVG for crisp
labelled geometry, Canvas for animation and dense plots, and the supplied
global `THREE` only when depth and camera movement genuinely matter.

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
`<script src="main.js"></script>`. Put no inline handlers or scripts in HTML.

`styles.css` owns the prompt-specific layout. It must be responsive and may use
the host tokens above. Flat fills only: the publication gate rejects shadows,
gradients, imports, and URLs.

`main.js` owns the real interaction and may use DOM APIs, SVG, Canvas 2D,
`requestAnimationFrame`, pointer/keyboard events, ResizeObserver, and the
supplied global `THREE`. Keep physics and geometry finite and deterministic.
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
package to `interactive_visualizer_revise`. A failed revision must preserve the
last ready version. Use rollback only for a previously validated version and
cancel when the user asks to stop.
