# Breadboard patches

The renderer keeps Quartz's D3/Pixi global-graph behavior while replacing:

- `contentIndex.json` loading with a passed `QuartzBrainGraph`;
- page/tag-only data with generic Breadboard node metadata;
- `window.spaNavigate` with selection/open callbacks;
- Quartz `nav` lifecycle hooks with a React-owned controller and teardown;
- the perpetual animation loop with simulation/tween-driven frames that stop
  after settling;
- one-shot graph construction with position-preserving incremental updates;
- Quartz visited-page storage with a private revisioned layout key containing
  positions and viewport only.

The original global graph tuning remains the baseline: charge `-230`, center
strength `0.04`, link distance `165`, collision iterations `6`, alpha decay
`0.018`, velocity decay `0.5`, zoom extent `0.25–4`, neighbor focus, label
opacity tied to zoom, and drag pinning with a gentle simulation restart.
