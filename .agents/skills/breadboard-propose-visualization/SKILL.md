---
name: breadboard-propose-visualization
description: Draft and submit a typed proposal for an interactive visualization on a Breadboard page. Produces a reviewable proposal, never a direct publish. Use when a concept would be clearer with a visual.
---

# Propose a visualization

Procedure for proposing an interactive visualization.

1. Identify the concept on the page that would benefit from a visualization and
   retrieve the grounded content with `garden_get_page`.
2. Design a bounded, well-specified visualization: what it shows, its inputs, and
   how it maps to the page's concepts. Keep it faithful to the source material.
3. Submit with `garden_propose_visualization`, providing:
   - `pageSlug`, a `description`, and a structured `spec`
   - `rationale` explaining the pedagogical value
4. Tell the reader a proposal was created for their review; you do not publish
   visualizations directly.
