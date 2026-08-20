# Quartz graph provenance

- Upstream: https://github.com/jackyzha0/quartz
- Vendored Breadboard checkout: Quartz `4.5.2`
- Checkout revision: `ca1848a6dabb2ff3ee632b5b6116a8345864a977`
- Reference files: `quartz/components/Graph.tsx`,
  `quartz/components/scripts/graph.inline.ts`, and
  `quartz/components/styles/graph.scss`
- License: MIT (copied as `LICENSE` in this directory)

No upstream file is compiled from this directory. The Breadboard-owned port is
`dashboard/src/lib/quartz-brain-graph/renderer.ts`; this record stays beside the
port so its origin cannot be lost.

To update, compare the three reference files at a new upstream revision, port
force/interaction/rendering changes intentionally, run the Quartz and Brain Map
behavior tests, then update the revision and patch notes here.
