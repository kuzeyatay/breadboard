# Timeline Studio Roadmap

This roadmap lists public, user-facing work that is planned or currently in development. It is intentionally separate from the release history:

- [GitHub Releases](https://github.com/MartinDelophy/ai-video-editor/releases) records features that have shipped.
- This roadmap records what is being explored, implemented, or polished next.
- [GitHub Issues](https://github.com/MartinDelophy/ai-video-editor/issues) is the place for reproducible bugs and focused implementation discussions.

Last updated: July 29, 2026.

## Status

- **In development** — implementation is underway, but the feature is not part of a stable release yet.
- **Planned** — accepted direction; implementation has not started or is not ready for review.
- **Needs investigation** — the problem is known, but the cross-platform solution still needs validation.

## Effects workspace

| Item | Status | Scope |
| --- | --- | --- |
| Person outline | In development | Browser-local single-person analysis, progressive frame commits, material-based outlines, clip-scoped settings, and preview/export integration. |
| Object outline | Planned | Select and track an object independently from the person-effects pipeline, then apply reusable outline materials. |
| Optical Flow Tracking | Planned | Visualize tracked movement from point A to point B with a cyan vector/wireframe treatment and motion-flow arrows. |
| Sway Motion | Planned | Add a controllable stylized sway animation with consistent preview and deterministic export behavior. |

## Editing and rendering

| Item | Status | Scope |
| --- | --- | --- |
| Non-linear video curves | Planned | Add an editable curve interface for non-linear speed ramps and other time-varying video properties, with keyframe interpolation shared by preview and export. |
| Windows font clarity | Needs investigation | Improve caption and UI font rasterization on Windows, especially at fractional scaling and on lower-density displays. Validate font loading, weight selection, hinting, and Canvas/export parity. |
| Person-outline quality hardening | In development | Improve identity locking, reject masks that merge bystanders or furniture, and fail closed on unreliable frames. |
| Effects parity for overlays | In development | Keep person effects bound to the exact picture-in-picture clip and preserve the same settings in preview, saved projects, and export. |
| Responsive effects workflow | In development | Keep the desktop inspector and the mobile single-purpose drawer functionally aligned. |
| Export consistency | In development | Continue reducing differences between realtime preview, deterministic rendering, and compatibility export paths. |

## Contribution guidance

Before starting a large item, open a [GitHub Discussion](https://github.com/MartinDelophy/ai-video-editor/discussions) or a focused issue describing:

1. the user workflow;
2. desktop and mobile behavior;
3. preview and export expectations;
4. browser/platform constraints;
5. a small acceptance checklist.

Pull requests are easier to review when they cover one roadmap item or one independently testable slice.
