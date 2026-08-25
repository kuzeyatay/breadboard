# Breadboard visualization pipeline

## Audited legacy flow

The production path before generated modules is:

~~~text
uploaded sources
  -> source figure/formula/table extraction
  -> Learning Spine + Learning Unit Contract
  -> optional interactiveVisual contract
  -> contract normalization/compatibility filtering
  -> learner-page generation
  -> VisualSpec JSON generation
  -> deterministic VisualSpec sanitization
  -> .breadboard/visuals/<id>.json + visual-index.json
  -> ```breadboard-visual fenced JSON in learning Markdown
  -> Quartz BreadboardVisuals transformer
  -> trusted DOM renderer selected from a fixed dispatch table
~~~

Key implementation points:

- `dashboard/src/lib/learn.ts` asks the Learning Spine planner for optional
  `interactiveVisual` records, converts confirmed contracts into subsection
  plans, generates pages, then calls `reconcileInteractiveVisuals`.
- `dashboard/src/lib/learning-unit-contract.ts` normalizes visual contracts,
  checks type/unit compatibility, computes duplicate signatures, and formerly
  removed every type outside a small hard-coded catalogue.
- `dashboard/src/lib/visuals.ts` asks ChatMock for one JSON `VisualSpec`,
  validates it, saves it, updates `visual-index.json`, and records events.
- `dashboard/src/lib/visual-spec.ts` validates and sanitizes untrusted JSON.
  A mirrored schema exists in `quartz/quartz/util/visualSpec.ts` for build-time
  validation.
- Learner Markdown embeds a complete trusted-renderer spec in a
  `breadboard-visual` fence. Source images remain ordinary Markdown images and
  are related through `sourceAnchors`; they are not interchangeable with the
  interactive visual.
- `quartz/quartz/plugins/transformers/breadboardVisual.ts` validates the fence
  and adds data attributes. `breadboardVisual.inline.ts` builds DOM using a
  fixed trusted renderer dispatch and supplies the existing regeneration UI.
- `dashboard/src/lib/garden-finalize.ts`, `dashboard/src/lib/final-garden-state.ts`,
  and `scripts/validate-breadboard-garden.ts` reconcile embedded specs, check
  source grounding, visual-index membership, contract fulfillment, unique
  signatures, and stale artifacts before publication.

Legacy failure behavior was not production-safe for open-ended visuals:

- The planning prompt said not to request custom types.
- Contract normalization discarded unsupported types.
- `learn_incompatible_visual_dropped` recorded the deletion, but the valuable
  opportunity was not rerouted.
- Visual generation could decline or fail and `learn_visual_skipped` was logged.
- Quartz removed invalid, unsupported, or failing visuals from the page, so a
  garden could look complete while containing no interaction.

## Hybrid control plane

The new path retains trusted renderers and adds a generated-module route:

```text
Learning Unit Contract
  -> garden-wide opportunity analysis
  -> semantic duplicate index
  -> compatibility scoring against shared/visualization-renderers.json
     -> trusted_renderer -> existing VisualSpec path
     -> generated_module -> structured candidate
          -> TypeScript AST allowlist
          -> SDK/manifest/source validation
          -> deterministic compilation
          -> static + semantic + browser runtime tests
          -> pedagogical critic
          -> versioned artifact publication
     -> intentional_omission -> explicit reason
  -> coverage gate/report
  -> stable subsection fence
  -> Quartz sandbox iframe
```

`shared/visualization-renderers.json` is the only catalogue of trusted
renderer IDs and pedagogical compatibility metadata. Dashboard planning and
Quartz build validation derive their supported IDs from it; renderer
implementation dispatch remains code, but it is checked against the registry.

Generated modules are declarative SDK programs, not unrestricted application
JavaScript. The model writes a typed `defineVisualization({...})` module. The
compiler parses it with the TypeScript AST, accepts only an import from
`@breadboard/visual-sdk` and one literal export, validates a bounded scene and
expression AST, and emits trusted compiler output. Quartz never executes the
model source. It resolves the artifact through `visual-index.json` and passes
the validated definition to a no-network, no-same-origin sandboxed iframe.

## Storage and lifecycle

Trusted specs remain backward-compatible:

```text
.breadboard/visuals/<id>.json
```

Generated modules use:

```text
.breadboard/visuals/<id>/
  manifest.json
  source.tsx
  compiled.js
  validation.json
  critic.json
  preview.png
  tests.json
  versions/<version>/...
```

The manifest, opportunity contract, route decision, source anchors, hashes,
validation records, critic record, and version history are the canonical
control plane. Markdown contains only the generated visual ID and version.

Failures are structured ledger events and enter a bounded repair loop. A
failure cannot crash Quartz: an unpublished visual is omitted with a build
warning, while a published artifact that later cannot load renders a native
fallback panel. Critical uncovered opportunities fail only when the configured
coverage gate is `fail`; high-priority gaps and zero-visual gardens are always
reported.

## Contracts and SDK surface

The persisted control-plane contracts are defined in
`dashboard/src/lib/visualization-opportunities.ts` and
`dashboard/src/lib/generated-visuals.ts`:

- `VisualizationOpportunity` records the exact learning unit, target page and
  heading, stable insertion anchor, source/formula/figure provenance, learner
  question, required controls and outputs, interaction goal, priority, and
  semantic fingerprint.
- `VisualizationRouteDecision` records the selected route, compatibility score,
  renderer (including a safe fallback renderer when one exists), and reason.
- `GeneratedVisualizationManifest` records SDK and schema versions, hashes,
  provenance, source-figure treatment, lifecycle status, model, attempt,
  current version, and previous version.
- `VisualizationCoverageReport` counts detected, published, omitted, rejected,
  and uncovered opportunities. It scores opportunity coverage rather than a
  raw visual quota.

The v1 SDK in `dashboard/src/lib/visual-sdk.ts` is declarative. It supports
labeled slider, number, select, toggle, and button controls; bounded arithmetic
and conditional expressions; value readouts; plots and markers; node-edge/flow
diagrams; timelines; tables; annotations and formula panels; status/boundary
states; animated markers; and controlled play, pause, step, and reset. The
runtime supplies responsive SVG, light/dark theme tokens, reduced-motion
handling, keyboard-native form controls, accessible names/live regions, and a
bounded animation clock. Generated source cannot supply callbacks or imperative
render code.

## Security and execution boundary

The trust boundary has three layers:

1. The model returns schema-enforced candidate JSON. `sourceCode` must be one
   TypeScript module whose only executable meaning is a literal
   `defineVisualization({...})` declaration.
2. The TypeScript compiler API parses the source AST. Imports, nodes,
   identifiers, expressions, source bytes, scene counts, controls, outputs,
   plot samples, labels, diagram coordinates, and expression depth are bounded.
   Network APIs, browser/application globals, storage, dynamic import, eval,
   process/filesystem APIs, external URLs, raw HTML, callbacks, prototype/global
   mutation, loops, recursion, and arbitrary packages are rejected. The emitted
   JavaScript is a fixed compiler-owned JSON assignment; model source is never
   executed.
3. Quartz loads the compiled definition into an iframe with `allow-scripts`
   only. It has no same-origin capability, network, navigation, popup, download,
   external script, object, form, media, or storage access. A strict `srcdoc`
   CSP and a two-message init/status protocol bound communication. Runtime
   errors hide the iframe and leave the lesson plus a native fallback panel.

The sandbox runtime is stored separately and imported as raw source through the
Quartz inline compiler. This keeps it directly syntax-testable and lets the
same runtime power pre-publication browser tests and the built Quartz page.

## Validation, repair, and critic sequence

Each generated attempt runs in this order:

1. Structured ChatMock candidate generation with bounded prompt/source context
   and output tokens.
2. AST and definition validation, then deterministic compiler output.
3. Static, formula/unit, source-anchor, control/output, boundary, and
   model-supplied semantic test cases.
4. Real Chromium/Edge mounts at mobile light, desktop dark, and desktop
   reduced-motion settings. The runtime changes a control, checks finite values,
   resets state, checks focusable native controls and horizontal overflow, and
   creates the critic preview.
5. A separate structured ChatMock critic receives the opportunity, evidence,
   source figures/formulas, test record, and preview image. It scores pedagogy,
   source fidelity, usability, and accessibility.
6. Atomic artifact publication and Markdown insertion only after approval.

Every rejected attempt is retained under
`attempts/<run-id>/attempt-<n>/` with candidate source and all available
validation, test, critic, lifecycle, and rejection evidence. A repair request
includes the prior source and exact failure packet. Attempts are bounded. When
they are exhausted, a sufficiently compatible deterministic trusted renderer
is used if one exists; otherwise the lesson publishes without broken markup and
coverage reports the gap. The working prior version is never overwritten.

## Placement, deduplication, figures, and finalization

The learning-unit insertion marker
`<!-- learning-unit:<id>:after-introduction -->` is created after the first
teaching paragraph. Generated Markdown contains only:

~~~markdown
```breadboard-generated-visual
id: visual-id
version: 1
```
~~~

The opportunity target, manifest target, heading, marker, Markdown fence,
visual index, artifact hash, tests, critic decision, and published status are
cross-checked by finalization and the standalone garden validator. Generated
visuals are rejected under `sources/`; no new visible top-level garden folder is
created.

The semantic fingerprint combines concepts, formulas, source figures, learning
objective, and interaction goal. The first equivalent opportunity owns the
visual; later equivalents receive an explicit merged omission. Source figures
remain source-image records. A generated manifest separately records whether a
figure is directly embedded, paired with an illustrative reconstruction, linked
from a reconstruction, or intentionally omitted, including the explanation and
fidelity label.

Canonical shadow builds remain diagnostic: they may import and evaluate visual
state in an OS-temporary rendered projection, but the shadow implementation
only writes `.breadboard/canonical-shadow/*` diagnostics and never changes or
publishes learner files.

## Regeneration and rollback

Quartz shows the existing Breadboard-styled **Regenerate** action on every
published generated visual. The endpoint accepts an optional author reason,
reload-protects with the current version, reuses the original opportunity and
source anchors, builds a complete candidate in staging, and changes Markdown
only after every gate passes. A failed request leaves the current version
active. Successful versions retain source, compiled output, preview, tests,
critic record, manifest, and lifecycle in `versions/<n>/`. When a prior version
exists Quartz also shows **Restore vN**; rollback revalidates its stored hashes
and approval evidence before atomically switching the page.

## Performance controls and observability

Generation is bounded by:

- a process-wide FIFO semaphore (`LEARN_GENERATED_VISUAL_CONCURRENCY`, default
  `2`, hard cap `8`);
- a per-attempt timeout and external Learn cancellation signal;
- bounded generation and critic output-token budgets;
- source-hash + semantic-fingerprint + SDK-version compilation caching;
- sequential dependency-aware page insertion, with parallelism available only
  for independent callers;
- bounded repair and critic retries;
- per-page and per-garden publication limits; and
- semantic reuse/omission before any model call.

Events include opportunity/route decisions, model generation, compilation and
cache status, semantic tests, browser tests, critic review/retry/rejection,
publication, fallback, regeneration, replacement/rollback, resource limits,
zero-visual warnings, and coverage completion/failure. Events include duration,
attempt, route, anchors, artifact paths, failure category, and before/after
status where applicable. ChatMock token usage is attached when the provider
returns it.

The demonstrated real run on 2026-07-16 measured:

| Stage | Observed time |
| --- | ---: |
| Real `gpt-5.6-sol` candidate through compiler | 37.486 s |
| Browser tests, critic, and atomic publication remainder | 15.271 s |
| Full generated-visual pipeline | 52.757 s |
| Three-scenario local browser gate after hardening | 4.997 s |
| Quartz parse, validate, and seven-page demo build | 1.000 s |

The demo predates the more granular stage event names, so its first two rows are
derived from persisted event timestamps. New runs emit separate timings for
model generation, compilation, semantic tests, browser tests, critic review,
and publication.

## Configuration and rollout

| Variable | Default | Purpose |
| --- | --- | --- |
| `LEARN_GENERATED_VISUALS_ENABLED` | `true` | Enable generated-module routing. |
| `LEARN_VISUAL_COVERAGE_GATE` | `warning` | `off`, `warning`, or `fail`; critical gaps fail only in `fail`. |
| `LEARN_GENERATED_VISUAL_MAX_ATTEMPTS` | `3` | Bounded semantic generation/repair attempts (hard cap 8). |
| `LEARN_GENERATED_VISUAL_CRITIC_ATTEMPTS` | `2` | Structured critic retries (hard cap 3). |
| `LEARN_GENERATED_VISUAL_CONCURRENCY` | `2` | Independent generated visuals in flight (hard cap 8). |
| `LEARN_GENERATED_VISUAL_MAX_PER_GARDEN` | `12` | Published generated modules per Learn run. |
| `LEARN_GENERATED_VISUAL_MAX_PER_PAGE` | `3` | Published generated modules on one page. |
| `LEARN_GENERATED_VISUAL_TIMEOUT_MS` | `1200000` | Soft observability threshold for one author/critic request. |
| `LEARN_GENERATED_VISUAL_LATE_RESULT_GRACE_MS` | `660000` | Additional wait for the same request; combined wait is capped at 31 minutes. |
| `LEARN_GENERATED_VISUAL_BROWSER_TESTS` | `true` | Real browser publication gate; keep enabled in production. |
| `LEARN_GENERATED_VISUAL_MAX_OUTPUT_TOKENS` | provider bounded | Candidate token ceiling. |
| `LEARN_GENERATED_VISUAL_CRITIC_MAX_OUTPUT_TOKENS` | provider bounded | Critic token ceiling. |
| `BREADBOARD_VISUAL_BROWSER_PATH` | auto-detect | Edge/Chromium executable used by the gate. |

Recommended rollout keeps the coverage gate at `warning` while observing
latency and rejection categories, then moves it to `fail` for gardens where
critical opportunity coverage is required. Browser tests must remain enabled on
publishing workers; configure the executable explicitly when auto-detection is
not reliable.

## Operational runbook

- **Generation transport ambiguity:** the exact request ID/hash and bounded
  routing/usage evidence are retained without prompt or image payloads. The
  original request is observed through the finite grace period and later runs
  may adopt only its exact durable receipt; transport failure never becomes a
  semantic repair request or an unbound retry.
- **AST or schema rejection:** inspect `validation.json` and `rejection.json`;
  do not relax the forbidden-global policy to admit an individual candidate.
- **Browser failure:** inspect `tests.json` and `preview.png`, verify the browser
  executable, then reproduce with the stored `source.tsx`. Missing browsers are
  a publication failure, not a silent skip.
- **Critic rejection:** inspect `critic.json`; repairs always return through all
  deterministic gates.
- **Quartz artifact mismatch:** the transformer renders a fallback and the
  final validator reports manifest/hash/index/fence inconsistencies. Restore a
  validated prior version or regenerate.
- **Cancellation:** Learn aborts waiting/running model work, removes staging on
  normal failure cleanup, and run snapshots restore only the cancelled run's
  changes.

## Demonstrated vertical slice

`quartz/content/generated-visual-demo` is a real garden with only the normal
visible `sources/` and `learning/` structure. ChatMock `gpt-5.6-sol` generated
`visual-contact-threshold-feedback`, which was AST-validated, compiled,
semantically tested, mounted in Edge at supported viewports, previewed, approved
by the structured critic, inserted after its concept introduction, and built by
Quartz. The real built-page screenshot is
`docs/generated-visual-quartz.png`.

Persisted demonstration result:

~~~text
Opportunities detected: 1
Trusted visuals published: 0
Generated visuals published: 1
Intentional omissions: 0
Validation failures: 0
Compilation failures: 0
Runtime failures: 0
Critic rejections: 0
Uncovered critical opportunities: 0
Final coverage status: pass
~~~

Known v1 limits are intentional safety boundaries: generated modules are
declarative rather than arbitrary React, scenes use the built-in SVG/DOM
primitives only, model prompts are capped at five scenes even though the
compiler can validate more, and regeneration's optional critique is currently
accepted by the endpoint rather than collected in a dedicated Quartz text
field. These limits do not affect trusted-renderer compatibility or existing
`breadboard-visual` gardens.
