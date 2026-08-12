# Authoring

Translate the request directly into a small concept-specific interface. Do not
route new work through a fixed scene catalog or generic application shell.

Use SVG for crisp labelled geometry, Canvas for dense or animated 2D work, and
the supplied Three.js global only for genuinely spatial models. Infer a useful
initial state and a few safe input ranges instead of asking for every setting.

The main visual comes first and occupies most of the response. Follow it with
at most one result strip and one compact control area. Avoid sidebars, nested
cards, control-panel headings, shadows, gradients, and explanatory paragraphs
inside the artifact.

Keep calculations bounded and finite. Use `requestAnimationFrame` for motion,
resize from the element's real dimensions, pause while hidden, and respect
reduced motion. Every control is labelled and keyboard usable.

Generation is one pass through `interactive_visualizer_create`; the server owns
validation, sandbox bundling, browser testing, persistence, and publication.
