---
name: diagram-in-chat
description: "Draw clear, zoomable SVG diagrams directly in chat: flows, architecture, mechanisms, hierarchies, sequences, and grouped systems. Use for ordinary diagram requests and visual explanations of connected parts. Honor explicit requests for ASCII, source markup, or another diagram style."
---

# Diagram in Chat

Make the relationships readable in the response itself. Use the same persistent,
sandboxed inline surface as Interactive Visualizer in Chat. The default look is
a quiet ChatGPT-style diagram: rounded blue nodes, fine connectors, small edge
labels, shaded groups, and generous space. No separate website or file is needed
from the user. Keep all important information visible before any interaction.

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - interactive_visualizer_create
    - interactive_visualizer_revise
    - interactive_visualizer_rollback
    - interactive_visualizer_cancel
  requiredArtifactKinds: [html]
  requiredRuntimes: [interactive-visualizer-runtime]
  requiredMcpServers: []
  optionalMcpServers: []

## Delivery

Call `interactive_visualizer_create` with the complete `plan` and `package` in
one call. Selection of this skill supplies `sourceSkill: "diagram-in-chat"`;
the host displays the published artifact inline in Ask Here, browser answers,
Garden chat, workspace chat, and the main assistant. Do not call `artifact_create`
for a plain HTML file: it lacks this interactive inline presentation. Do not
return an ASCII drawing, a Mermaid fence, or HTML source in place of the visual.
Explicit user requests for those formats take precedence.

Author the package directly; no terminal, repository inspection, or separate
browser run is necessary. Publication validates and browser-tests it. Repair a
specific rejected field or geometry issue, at most two repairs, keeping any last
ready artifact intact. For follow-ups, reuse the existing artifact ID with
`interactive_visualizer_revise`, supplying a complete replacement package and
`revisionPrompt`. After success, add only the explanation the diagram needs.

## Meaning before geometry

Identify the nodes, directed relationships, feedback paths, and real grouping
boundaries. A container means membership, not sequence. Preserve distinctions
such as air supply versus control signal, request versus response, and alternate
valve paths. Label uncertainty rather than inventing a connection. If showing
mutually exclusive paths together, say they are alternatives. Choose top-down
flow or left-to-right flow to fit the subject and available width. Split a dense
system into a few coherent views rather than shrinking every label.

Use SVG for crisp text and geometry. Start with a viewBox around 760 by 600;
adjust to the actual drawing's bounds with at least 24 units of padding. Nodes
are usually 150–230 units wide and 52–72 tall, with 14–18 unit corner radii.
Use 14–16 unit sans-serif labels, weight 500–600; wrap long labels into explicit
`tspan` lines. Allow 48–72 units between nodes and additional space for edge
labels. Keep groups behind their contents with about 24 units of padding and
36 units of space for the group title. Fit the complete diagram initially.

Define node rectangles once and derive named north/south/east/west anchors from
them. Edges must start and end at these anchors; route orthogonal paths around
other nodes, with gentle rounded bends. Draw connectors before nodes and labels.
Use thin strokes (about 1.2–1.5 units) and small arrowheads. Put short edge labels
on a background pill centered on an unobstructed segment. Keep feedback paths
in a separate lane. Never run a line through a label or an unrelated node.

For node-and-edge diagrams, actually generate the SVG from that shared geometry
in `main.js`; independently typed path endpoints drift. For example:

```js
const nodes = { tank: { x:300, y:180, w:180, h:60 } };
function port(id, side, fraction=.5) {
  const n=nodes[id];
  return side==='N' ? [n.x+n.w*fraction,n.y] :
         side==='S' ? [n.x+n.w*fraction,n.y+n.h] :
         side==='W' ? [n.x,n.y+n.h*fraction] : [n.x+n.w,n.y+n.h*fraction];
}
```

Generate each rectangle and its text from `nodes`, and each route from its two
ports plus intermediate bend points. Use `data-node="tank"` on the node group,
and `data-from="tank" data-to="switch"` on its edge path. Create SVG elements
with `document.createElementNS(svg.namespaceURI, tag)`. Compute each edge-label
pill center from the midpoint of a chosen straight route segment, then size the
pill to the text. A nearby floating badge does not label a connection clearly.

## Surface and interaction

Use the host's theme, including when it changes while the diagram is open.
All colors must derive from `--viz-bg`, `--viz-panel`, `--viz-text`, `--viz-muted`,
`--viz-line`, `--viz-accent`, `--viz-accent-text`, or the host's diagram tokens.
The diagram tokens supply navy blue nodes and pale blue text in dark mode,
and pale blue nodes with dark blue text in light mode. Use this starting palette:

```css
.node { fill: var(--viz-diagram-node); stroke: var(--viz-diagram-border); }
.node-label { fill: var(--viz-diagram-text); font-size: 15px; font-weight: 550; }
.edge { fill: none; stroke: var(--viz-muted); stroke-width: 1.25; }
.group { fill: var(--viz-diagram-group); stroke: var(--viz-line); }
.edge-label { fill: var(--viz-text); font-size: 12px; }
.edge-pill { fill: var(--viz-bg); stroke: var(--viz-line); }
```

Keep the canvas transparent in inline mode. No decorative gradients, shadows,
cards within cards, oversized hero heading, numbered badges, or dashboard panels.
Use one small H1 and a compact toolbar with buttons at least 28px tall and normal
text line-height. Provide labelled native Zoom in, Zoom out,
and Fit diagram buttons, with `data-action="zoom-in"`, `data-action="zoom-out"`,
and `data-action="fit"`. Update the SVG viewBox for zoom; the shared runtime
connects the wheel to these controls. Support dragging the zoomed canvas to pan,
plus arrow-key panning on a focusable SVG. Set `user-select:none` and
`touch-action:none` on the draggable SVG so panning cannot select its labels.
Fit restores the complete view.
Prevent default pointer/wheel behavior only while actually handling navigation;
preserve normal chat scrolling and browser Ctrl/Cmd-wheel zoom.

Interactions inspect the diagram, not simulate it. Set animation disabled and
do not add Play/Pause or sliders to a static flowchart. If the user needs changing
physical state, time evolution, or a spatial simulation, use the interactive
visualizer guidance instead. A node detail panel is optional; it must not hide
essential labels or connections.

Use `svg { width:100%; height:auto }`, with natural content height and wrapping
toolbar controls. Do not create nested scrolling or fixed viewport-height apps.
For narrow panes, simplify/reflow the layout or retain a readable initial scale
with accessible zoom. Provide a useful SVG `title` and `desc` describing the
connections, plus accessible names for every control. Maintain contrast in both
themes. Give the SVG a nonzero viewBox and use explicit width/height attributes.

## Exact tool envelope

`plan` is schema **1** (the package below is schema **2**):

```json
{
  "schemaVersion": 1,
  "title": "Short diagram title",
  "objective": "The relationship this diagram explains",
  "mode": "2d",
  "rationale": "Connected parts and group boundaries are expressed in a plane.",
  "concepts": ["The actual subject"],
  "assumptions": [],
  "controls": [
    {"id":"zoom-in","label":"Zoom in","type":"button","purpose":"Inspect labels"},
    {"id":"zoom-out","label":"Zoom out","type":"button","purpose":"See context"},
    {"id":"fit","label":"Fit diagram","type":"button","purpose":"Restore the complete diagram"}
  ],
  "outputs": [{"id":"diagram","label":"Diagram","purpose":"Show the requested relationships"}],
  "interactions": ["Zoom and pan to inspect; fit to restore the complete view"],
  "animation": {"enabled":false,"canPause":false,"canReset":false},
  "dataRequirements": [],
  "assetRequirements": [],
  "accessibilityRequirements": ["Keyboard zoom and pan; labelled SVG and controls"],
  "sourceReferences": []
}
```

The `package` contains:

- `schemaVersion: 2`.
- `manifest`: `schemaVersion: 2`, `artifactType: "interactive-visualizer"`,
  `title`, `description`, `accessibilityDescription`, `mode: "2d"`,
  `entry: "index.html"`, and
  `runtime: {id: "breadboard-interactive-visualizer", version: "2.0.0"}`.
- `assumptions` and `limitations`: string arrays. `sourceReferences`: an array
  of `{label, url?, gardenSlug?}` using only real sources already consulted.
- `semanticTests`: `{name, assertion}` entries for the actual directional and
  grouping relationships, plus a **visual integrity** assertion about endpoint
  continuity, group containment, contrast, label overlap, and clipping.
- `assets: []`.
- `files`: exactly `index.html`, `styles.css`, and `main.js`, each a full string.

HTML needs a semantic `#app`, one visible `h1`, the SVG, native controls, and
exactly `<script src="main.js"></script>`. Put CSS in `styles.css`; the host
inlines it. Do not include an SVG namespace URL: inline HTML already supplies
the SVG namespace. Internal SVG markers may use `marker-end="url(#arrow)"`;
CSS URLs and all external URLs in the three files are forbidden. No inline
scripts or event handlers. Attach interaction listeners in `main.js`.

The package runs offline in an opaque sandbox: no network, imports, storage,
navigation, workers, nested frames, arbitrary host messaging, or eval. CSS and
SVG use host tokens, so theme changes need no JavaScript repaint.

Before submitting, trace every arrow against the stated relationships, ensure
no label exceeds its node, and check that the initial view includes every node,
group and edge label. The tool's browser gate verifies runtime behavior; the
semantic assertions must describe real properties, not merely say “looks good.”
