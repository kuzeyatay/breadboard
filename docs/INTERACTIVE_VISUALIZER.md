# Interactive visualizer

## Scope and architecture

`interactive-visualizer` is a checked-in first-party skill for authenticated
Garden Chat and Breadboard Terminal conversations. It produces versioned HTML
artifacts in the existing artifact archive. It is not available in Quartz AI,
anonymous Quartz, or public garden pages.

There are two layers:

1. `hermes-skills/prebuilt/interactive-visualizer` supplies reviewed
   invocation and authoring guidance.
2. Breadboard's server-owned artifact capability plans, validates, compiles,
   browser-tests, persists, streams, revises, restores, and cancels artifacts.

The Hermes tool module and embedded Hermes `breadboard` plugin expose the
same five structured operations (plan, generate, revise, rollback, cancel).
Both return over an authenticated loopback route; neither runtime receives
ownership fields, storage paths, or durable write authority. The selected
skill embeds the literal definition contract because the isolated Hermes
session intentionally has no general file-reading tool.

Strong visualization intent is converted server-side into the normal reviewed
`/interactive-visualizer` skill selection. Explicit slash selection uses the
same path. The skill cannot widen the capability broker's surface ceiling.

## Existing Learn/Quartz visualizations

The Learn/Quartz generated-visual pipeline remains in
`dashboard/src/lib/generated-visuals.ts`, uses
`dashboard/src/lib/visual-sdk.ts`, and publishes validated garden content for
Quartz. Conversational interactive visualizers instead use canonical
Hermes artifacts and the Artifacts tab. Both paths use declarative AST
validation, deterministic compilation, real browser gates, and sandboxed
rendering, but have different ownership and publication destinations. The
conversational path does not write a garden or inject code into Quartz.

## Contract and lifecycle

The plan records objective, audience, 2D/3D/hybrid rationale, concepts,
assumptions, controls, outputs, interactions, animation semantics, data and
asset requirements, accessibility, and source references.

Generation returns a version-1 manifest, assumptions, limitations, source
references, semantic assertions, an empty v1 asset list, and exactly:

- passive `index.html`;
- local `styles.css`;
- declarative `main.ts`.

The module imports only `defineVisualizer` from
`@breadboard/interactive-visualizer-sdk` and exports one literal definition.
Breadboard transitions through planned, generating, validating, building,
browser testing, repairing, and a ready/failed/cancelled terminal state. The
durable extension tables retain plan and job evidence while canonical artifact
tables remain authoritative for ownership, content, version history, restore,
preview, refresh, and streaming.

Publication is atomic. A revision stages the next monotonically increasing
version and switches `current_version` only after every gate passes. A failed
revision records its job and error but keeps the last ready output active.
Rollback activates an already validated canonical version without deleting
later history.

## Validation and trust boundary

The model and generated package are untrusted. Validation never imports or
executes generated source on the server:

1. validate the plan, manifest, evidence, file list, and byte ceilings;
2. parse passive HTML with a tag and attribute allowlist;
3. parse CSS independently and reject imports, URLs, and executable behavior;
4. parse TypeScript with the compiler AST;
5. require one allowlisted import and one literal `defineVisualizer` export;
6. validate bounded controls, expression trees, scenes, Three.js object and
   vertex estimates, finite ranges, and schema relationships;
7. bundle only the compiler-owned runtime and local pinned Three.js with
   esbuild;
8. inject compiler-owned CSP and markup;
9. mount desktop light, desktop dark, reduced-motion, and mobile scenarios in
   Chromium or Microsoft Edge;
10. exercise a native control, Play/Pause/Reset where present, finite output
    checks, WebGL initialization, and horizontal-overflow checks;
11. capture a preview and publish only on full success.

The iframe uses `sandbox="allow-scripts"` with an opaque origin, an empty
Permissions Policy, no referrer, and no same-origin, navigation, popup,
download, form, or top-navigation capability. Its CSP denies all by default,
network connections, workers, frames, objects, forms, external fonts/media,
and base URLs. Inline scripts and styles are the only relaxations because the
audited compiler emits a self-contained document. The host protocol is
versioned and validates the source window, opaque `null` origin, message shape,
and random per-frame channel. It exposes ready, resize, and theme only.

Generated code receives no cookie, storage, network, provider configuration,
filesystem, MCP, Hermes, ChatMock, capability token, runtime URL, private
conversation history, or general host RPC. Source references remain server
metadata. Schema version 1 accepts no generated assets, remote assets, shaders,
models, textures, WebXR, or arbitrary packages.

## Renderers

2D uses trusted responsive SVG plots, custom expression-driven SVG diagrams,
and Canvas double-pendulum dynamics with bounded expression trees, labelled
controls, units, outputs, resize observers, finite-value guards, and mobile
layout.

3D uses local `three@0.185.1`, custom bounded generated-geometry scenes and
orbital scenes, perspective or orthographic camera, keyboard/pointer orbit and
wheel zoom, lighting, full orbit paths, bounded recent-position trails,
velocity arrows, gravity/initial-velocity/time scaling, responsive resize,
SwiftShader publication testing, fallback text, hidden-tab pause, and explicit
disposal of geometries, materials, renderer, observers, and listeners. Hybrid
definitions combine at least one 2D and one 3D scene.

Animated definitions receive trusted Play, Pause, and Reset controls.
Reduced-motion media queries eliminate decorative transitions; render loops
pause when the document is hidden.

## Authorization, tools, and observability

Identity, conversation, assistant message, garden, runtime session, and run
scope are injected from the authorized server session. Model arguments contain
only an opaque artifact ID and structured content. Every read, revise, cancel,
or rollback resolves the artifact through the existing owner, conversation,
and garden authorization check.

The skill can use other approved Breadboard tools while planning, but generated
code cannot. Schema v1 has no asset-ingestion operation. Artifact events record
planning, generation, validation, building, browser testing, repair,
publication, failure, and cancellation without source bodies, prompts, tokens,
secrets, or internal paths. Existing tool and capability audit records cover
skill selection, tool calls, and authorization failures.

The existing Stop route terminates the runtime request, terminal work, and the
active browser process tree. Candidate temporary directories are scoped under
the OS temp directory and removed in `finally`.

## Configuration

Defaults are conservative and server-only:

```text
INTERACTIVE_VISUALIZER_ENABLED=true
INTERACTIVE_VISUALIZER_BROWSER_TESTS=true
INTERACTIVE_VISUALIZER_THREE_ENABLED=true
INTERACTIVE_VISUALIZER_MAX_ATTEMPTS=3
INTERACTIVE_VISUALIZER_MAX_SOURCE_BYTES=80000
INTERACTIVE_VISUALIZER_MAX_BUNDLE_BYTES=1000000
INTERACTIVE_VISUALIZER_MAX_ARTIFACT_BYTES=2000000
INTERACTIVE_VISUALIZER_BROWSER_TIMEOUT_MS=22000
INTERACTIVE_VISUALIZER_MAX_THREE_OBJECTS=256
INTERACTIVE_VISUALIZER_MAX_VERTICES=100000
```

Attempts cannot be configured above three. Values are clamped to audited
bounds. Disabling the feature or the mandatory browser gate makes visualizer
tools return an explicit unavailable response; Garden Chat and Terminal remain
usable. `BREADBOARD_VISUAL_BROWSER_PATH` can select a local Chromium-compatible
executable.

## Desktop packaging

The standalone trace includes esbuild, its Windows binary, and Three.js. App
resource staging includes the immutable first-party skill, Hermes tool
configuration, and dashboard runtime. Package verification checks all of these.
No CDN is required. The browser runner launches hidden children, kills the
process tree on cancellation/timeout, and cleanup removes staging directories.
For a release acceptance run, set
`BREADBOARD_SMOKE_INTERACTIVE_VISUALIZER=true` before invoking
`desktop/scripts/installed-smoke-test.mjs`; the installed application then
creates authenticated Terminal conversations for the required 2D pendulum and
3D Moon-orbit prompts, waits for ready artifacts, checks their packaged preview
routes and CSP, restarts the application, and verifies durable restoration.

## Troubleshooting and limitations

- “No configured Chromium” means the mandatory publication gate cannot run;
  configure `BREADBOARD_VISUAL_BROWSER_PATH` or install Edge/Chromium.
- A `repairable` result includes the exact bounded validation/browser packet.
  Correct that packet and resubmit the same artifact; do not relax policy.
- Three.js fallback is user-visible, but publication requires a working
  software WebGL path so a broken 3D candidate cannot be marked ready.
- Schema v1 intentionally supports bounded custom SVG primitives, plots,
  double-pendulum dynamics, generated Three.js primitives, and orbital geometry
  rather than arbitrary JavaScript. It does not yet ingest authorized local
  assets or offer arbitrary custom shaders/models.
- The independent model critic used by the Learn pipeline is not shared yet;
  deterministic security, semantic, interaction, accessibility, and browser
  gates remain mandatory and authoritative.
