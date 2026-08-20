# Breadboard Knowledge Map

The user-facing product name is **Knowledge Map**. Existing `brain-*` source,
API, database, and storage identifiers are retained as compatibility contracts;
they are implementation names, not UI copy.

## Local integration inventory and data flow

This inventory describes the working tree used for the implementation, not an
older remote branch.

### Organization and Buzz path

- `dashboard/src/lib/organizations/store.ts` and `types.ts` are the existing
  organization authority. Organizations use numeric database keys internally,
  roles are `owner | admin | member`, and the Knowledge API derives opaque public
  scope IDs without adding another organization model.
- `dashboard/src/lib/buzz/schema.ts`, `store.ts`, and `instance.ts` are the
  existing Buzz read/write model. An organization is a Buzz community. Rooms
  are `channel` or `dm`, public/private room access is enforced by
  `listRoomsForUser`, room membership narrows private access, and threads are
  root messages with bounded replies.
- `dashboard/src/app/api/buzz/**` remains the Buzz server boundary.
  `dashboard/src/app/buzz/**` remains the only Buzz client. The Knowledge Map does
  not create a relay, duplicate transcript store, second client, or direct
  browser connection.
- `dashboard/src/lib/buzz/agent-bridge.ts` continues to run Buzz agents through
  ordinary Breadboard conversation machinery. The Knowledge adapter only exposes a
  meaningful agent identity when it is explicitly connected to an authorized
  room or output.
- `dashboard/src/app/buzz/page.tsx` now resolves Knowledge deep links after
  `listRoomsForUser`; opaque thread IDs are compared only against roots inside
  the already-authorized room.

### Quartz graph path

- The vendored Garden graph is Quartz 4.5.2 at revision
  `ca1848a6dabb2ff3ee632b5b6116a8345864a977`.
- Its component entrypoint is `quartz/quartz/components/Graph.tsx`; the D3/Pixi
  renderer is `quartz/quartz/components/scripts/graph.inline.ts`; visual styles
  are in `quartz/quartz/components/styles/graph.scss`.
- The Garden graph still reads the Quartz content index and keeps its existing
  local/global behavior. No Garden Quartz file was changed for the Profile
  feature.
- `dashboard/src/lib/quartz-brain-graph/renderer.ts` is a documented direct port
  of the global renderer core. It receives passed graph data and callbacks; it
  never reads `contentIndex.json` and has no authorization responsibility.
- Provenance, the MIT license, local differences, and update instructions are
  in `dashboard/src/vendor/quartz-graph/`.

### End-to-end data flow

```text
NextAuth session
  -> server-derived BrainGraphAccessContext
  -> bounded Organization / Garden / Conversation / Memory / Artifact / Buzz adapters
  -> optional authorized GBrain health or selected-node expansion
  -> normalize, deduplicate, sanitize URLs, prune missing endpoints, recount
  -> private no-store BrainGraphResponse
  -> Breadboard-to-Quartz adapter
  -> D3 force simulation + Pixi renderer in Profile / Knowledge
```

Canonical Garden Markdown is still scanned by
`scanClusterKnowledge(..., { migrateSources: false })`; there is no second
Markdown parser and graph reads never migrate source files.

## Product behavior

The private `/profile` page has `Profile | Knowledge` tabs. The Knowledge
tab mounts lazily, fetches only while active, and occupies 72vh on desktop.
Organization links expose **View knowledge**, which opens the organization scope by
opaque ID. Supported links are:

```text
/profile?tab=knowledge&scope=personal
/profile?tab=knowledge&scope=all
/profile?tab=knowledge&scope=organization&organization=<opaque-public-id>
```

`/profile/[username]` remains a separate public redirect/surface and imports no
Knowledge component or graph route. Private data is not passed through the Profile
server component; the mounted Knowledge client requests it from the authenticated
API.

The UI provides scope, text search, node-kind, origin, Garden, organization,
date, and explicit-edge filters; overview/full modes; node inspection; open,
focus, and bounded expand actions; two-node shortest-path evidence; and Ask
Hermes/Synthesize draft actions. Hermes drafts contain stable node IDs only,
not graph labels or private text.

## Scope and authorization semantics

The access context is rebuilt from SQLite on every request. There is no graph
response cache, so organization or room removal takes effect on the next
request.

- **Personal** includes the viewer anchor, Gardens owned by the viewer,
  persistent user conversations, active non-superseded memories, owned ready
  artifacts, explicitly connected agents, and Buzz DMs/group DMs in which the
  viewer is a room participant.
- **Organization** requires current membership and includes the organization,
  policy-visible members, organization-shared Gardens and canonical knowledge,
  owned artifacts explicitly attached to those Gardens, public channels,
  private channels allowed by Buzz room membership, meaningful inherited-access
  threads, and connected agents. DMs are deliberately excluded from this scope.
- **All accessible** is the union of currently authorized data. Each source
  retains its normal authorization filter; unioning scopes does not turn a
  private Buzz room into a public one.

Organization membership and Buzz room membership are intersected. Public
channels require organization membership. Private channels require both
organization membership and a matching `buzz_room_members` row. DMs and group
DMs additionally require participation even if a legacy room row says
`visibility = public`. A thread is emitted only after its parent room has passed
that filter. Archived rooms and deleted thread roots are absent.

Forged, foreign, missing, and revoked organization IDs share the same 404
response. Expansion first rebuilds the authorized overview and rejects a node
not present in it. The client cannot provide a user ID, GBrain source ID, Buzz
row ID, or authorization set.

## Graph contract and taxonomy

`dashboard/src/lib/profile/brain-graph-types.ts` defines the shared sanitized
contract. Current real sources populate:

- anchors: `user`, `organization`, `garden`, `buzz_channel`;
- identity: `member`, `person`, `agent`;
- knowledge: `source`, `page`, `concept`;
- work: `conversation`, `memory`, `artifact`, `buzz_thread`.

Optional workflow, repository, task, schedule, calendar-event, canvas, and
agent-run kinds remain in the contract but are not manufactured without a
stable authorized read model and explicit relationship.

Edges use the contract vocabulary and always identify an origin:
`canonical`, `conversation`, `memory`, `artifact`, `organization`, `buzz`,
`agent`, or `gbrain-derived`. Canonical/frontmatter links, foreign keys,
membership, artifact provenance, and room/thread containment are explicit.
GBrain neighbors are derived and are visually faint. Semantic similarity is
not persisted as canonical truth.

IDs are namespaced. Safe public slugs/IDs are reused; numeric rows without a
public ID use an HMAC-derived stable token. Metadata is constructed field by
field. Absolute paths, emails, transcripts, credentials, embeddings, chunks,
internal GBrain source IDs, raw sessions, and arbitrary database rows are not
serialized.

## Source adapters

`dashboard/src/lib/profile/brain-graph.ts` orchestrates independent adapters in
`brain-graph-sources/`:

- `organizations.ts`: viewer, organizations, visible members, membership;
- `gardens.ts`: authorized Gardens and the canonical knowledge scanner;
- `conversations.ts`: the existing persistent-conversation query, Garden and
  explicit agent associations, never individual messages;
- `memories.ts`: active/default durable-memory inspection with superseded rows
  excluded and only stored provenance edges;
- `artifacts.ts`: ready owned artifacts, versions as metadata, source
  conversation/Garden/skill edges, never artifact bytes or content;
- `buzz.ts`: existing Buzz room/member/thread read model with deterministic
  meaningful-thread criteria and no message-per-node graph;
- `gbrain.ts`: health warning in overview and bounded selected-page neighbor
  expansion through `GBrainClient`.

Adapters fail independently. Final normalization rejects malformed nodes,
deduplicates identities, merges compatible provenance, validates navigation
against an internal-route allowlist, removes every edge with a missing
endpoint, applies caps, and recomputes counts from the final visible graph.

## API contracts

```text
GET /api/profile/brain-graph
  ?scope=personal|all|organization
  &organization=<opaque-id>
  &mode=overview|full

GET /api/profile/brain-graph/expand
  ?scope=personal|all|organization
  &organization=<opaque-id>
  &node=<stable-node-id>
  &depth=1|2
```

Both routes use the existing `requireUserId()` session path and return
`Cache-Control: private, no-store, no-cache, max-age=0, must-revalidate` plus
`Vary: Cookie`. Requests accept an abort signal. Error text does not distinguish
missing from inaccessible private objects.

## Overview selection and limits

Normalization scores nodes deterministically:

```text
importance = 45% anchor + 30% log-normalized degree
           + 15% 120-day exponential recency + 10% bounded activity
```

Overview limits are 1,500 nodes, 3,500 edges, 100 Gardens, 450 canonical nodes
per Garden, 160 conversations, 300 memories, 300 artifacts, 120 Buzz rooms,
and 40 meaningful threads per room. Full mode is still bounded at 2,000 nodes,
5,000 edges, 900 canonical nodes per Garden, 240 conversations, 500 artifacts,
and 80 threads per room. Expansion is one or two hops and each adapter remains
bounded. Truncation is visible in the UI.

## GBrain boundary and degraded sources

The browser never calls GBrain or supplies its authorized source list. For a
page expansion the server derives source IDs from the already-authorized Garden
set, invokes `GBrainClient`, and accepts a neighbor only after mapping it back to
an authorized canonical page. Overview health probing is bounded to 750ms.

- GBrain unavailable/degraded: canonical graph remains and a sanitized warning
  is returned.
- Buzz unavailable: other source fragments remain and a warning is returned.
- One Garden scan fails: that Garden anchor remains, other Gardens render, and
  the warning contains no filesystem path.
- WebGL/context/init failure: the same response is rendered as an accessible
  searchable/filterable/expandable list.

## Quartz renderer adaptation and lifecycle

The port preserves the current global graph baseline: charge `-230`, center
strength `0.04`, link distance `165`, collision iterations `6`, alpha decay
`0.018`, velocity decay `0.5`, zoom extent `0.25-4`, neighbor hover focus,
zoom-dependent sparse labels, D3 drag pinning, and Pixi circular nodes/thin
links. Light force clustering uses existing organization/Garden boundaries.
Derived edges use reduced width/opacity instead of a costly dashed renderer.

Expansion retains existing node objects and positions, places new nodes close
to the selected parent, and restarts at alpha `0.28`. Selection, search, and
evidence update renderer options without recreating Pixi. Filtered nodes remain
in the simulation but are invisible, so clearing a filter restores their
positions.

Layout state is browser-only and contains node IDs, x/y coordinates, and the
viewport transform—never labels or content. Keys are private, scope-specific,
and graph-revisioned. Scope changes clear selection, inspector, evidence, old
graph data, and the active renderer.

On unmount the client aborts fetches and expansion; the renderer stops the D3
simulation, cancels animation frames, removes zoom/drag/context listeners,
disconnects its `ResizeObserver`, destroys Pixi children/textures, and clears
the host. Reduced-motion mode settles with bounded synchronous ticks. D3 stops
its timer after simulation settlement.

Diagnostics contain counts and timings only: server build duration and adapter
durations, client adapter normalization, renderer initialization, simulation
settle time, and truncation. Labels, paths, messages, and source identifiers are
not logged.

## Desktop and offline packaging

`d3`, `pixi.js`, and `@tweenjs/tween.js` are dashboard dependencies at the same
major/current versions used by the vendored Quartz checkout. No graph code,
font, style, worker, or data is loaded from a CDN. The Knowledge renderer is in the
Next client bundle and does not require the Quartz dev server. The existing
Garden Quartz build remains independent.

Electron may initialize WebGL normally, restore after a context loss, or use the
same authorized list fallback when GPU/WebGL is unavailable. Installed-package
and GPU smoke checks still require an actual packaged desktop build; unit tests
do not claim to replace them.

## Test matrix

- `tests/brain-graph-core.test.mjs`: IDs, URL allowlist, merge/deduplication,
  provenance, endpoint pruning, counts, caps/importance, revision, Quartz
  adaptation/style/focus/labels/search/layout keys, incremental merge.
- `tests/brain-graph-authorization.test.mjs`: two users/two organizations,
  member/non-member, immediate revocation, private and organization Gardens,
  public/private channels, participant-only DM/group DM, private inherited
  thread access, cross-organization edge pruning, count/label isolation.
- `tests/brain-map-wiring.test.mjs`: private/public route separation, lazy tab,
  deep-link and View-brain wiring, abort/cleanup, cache headers, server-derived
  identity, bounded expansion, no GBrain client inputs, Quartz constants and
  lifecycle, reduced motion, WebGL fallback, filters and evidence controls.
- `npm run typecheck:knowledge`: isolated typecheck for the route, adapters,
  renderer, Profile integration, and Buzz deep-link integration.
- The existing dashboard, GBrain, Quartz, and desktop suites provide regression
  coverage; exact executed results belong in the implementation handoff rather
  than this durable architecture document.

## Cache invalidation

There is intentionally no private graph response cache or shared Next cache.
Each overview and expansion rebuilds authorization from current membership.
The revision is derived only from the final visible scope, node IDs/types and
visible update timestamps, plus visible edge IDs/endpoints. It cannot encode a
count of objects that were pruned as inaccessible. Client layout entries store
no labels, so stale layout data cannot reveal removed content.

## Known limitations

- The current Buzz read model has channels, DMs, threads, members, and agents;
  it has no stable canvas/workflow/repository object model to expose here.
- Organization artifacts are currently user-owned artifacts explicitly attached
  to an organization-shared Garden. The artifact store does not yet define a
  separate cross-user organization-artifact access policy, so the graph does
  not invent one.
- Expansion returns object relationships, not message bodies or artifact
  document previews. A future inspector-preview endpoint must reuse the same
  authorization context.
- Layout persistence is local to one browser profile and revision, not synced
  between devices.
- WebGL and installed Electron behavior require runtime smoke tests on a built
  package; the deterministic source/lifecycle tests cover failover contracts,
  not a physical GPU.

## Vendored code and update procedure

The port is licensed under Quartz's MIT license. See
`dashboard/src/vendor/quartz-graph/LICENSE`, `UPSTREAM.md`, and
`BREADBOARD_PATCHES.md`. To update: checkout the intended Quartz revision,
compare `Graph.tsx`, `graph.inline.ts`, and `graph.scss`, intentionally port
force/render/interaction changes, update provenance and patch notes, run the
Knowledge renderer tests, then build both Quartz and the dashboard. Do not copy from
an unlicensed graph implementation.
