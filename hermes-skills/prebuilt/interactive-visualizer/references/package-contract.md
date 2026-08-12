# Package contract

New visualizers use schema 2 and are prompt-specific sandboxed mini-apps:

```json
{
  "schemaVersion": 2,
  "manifest": {
    "schemaVersion": 2,
    "artifactType": "interactive-visualizer",
    "title": "Clear title",
    "description": "What changes and what to observe.",
    "accessibilityDescription": "A non-visual description of the model.",
    "mode": "2d",
    "entry": "index.html",
    "runtime": {
      "id": "breadboard-interactive-visualizer",
      "version": "2.0.0"
    }
  },
  "assumptions": ["The model is illustrative."],
  "limitations": ["Values are bounded."],
  "sourceReferences": [],
  "semanticTests": [
    { "name": "finite state", "assertion": "Displayed values remain finite." }
  ],
  "assets": [],
  "files": {
    "index.html": "<main id=\"app\">...</main><script src=\"main.js\"></script>",
    "styles.css": "/* prompt-specific flat responsive layout */",
    "main.js": "/* prompt-specific interaction and rendering */"
  }
}
```

For 3D or hybrid, add `"threeVersion": "0.185.1"`; the runtime exposes that
pinned build as global `THREE`.

HTML contains one semantic `#app`, one visible H1, a primary inline SVG or
Canvas, labelled native controls, and the external `main.js` tag. It contains no
inline handlers, forms, frames, external media, or URLs.

CSS uses the `--viz-*` host tokens. It is responsive and uses flat fills and
thin separators. Imports, URLs, gradients, and shadows are rejected.

JavaScript may use DOM, SVG, Canvas 2D, animation frames, ResizeObserver,
pointer/keyboard events, and optional global `THREE`. It cannot use network,
navigation, storage, workers, eval, dynamic imports, device capabilities,
arbitrary host messaging, or prototype changes.

Schema-1 `defineVisualizer` packages remain readable and revisable for existing
artifacts, but new generation should not use them.
