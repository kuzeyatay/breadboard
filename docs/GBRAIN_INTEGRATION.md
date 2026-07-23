# GBrain Integration

GBrain is Breadboard's **secure, garden-scoped knowledge retrieval layer**. It
answers *"what knowledge exists in the authorized garden sources?"* — a different
question from Breadboard's conversation memory, which answers *"what happened in
this conversation or project?"*. The two are separate and independently auditable.

This document describes the implementation as built, not the intended design.

## Architecture

```text
Garden Chat / AI Terminal (authenticated only)
          |
          v
Breadboard authenticated dashboard backend
          |
          +-- Breadboard conversation memory        (unchanged, authoritative)
          +-- Breadboard capability + permission gate (intersects GBrain tools)
          +-- Breadboard garden tools + proposals     (all writes are proposals)
          +-- Breadboard GBrain adapter client        (dashboard/src/lib/gbrain)
                    |
                    v  (loopback, secret-gated, garden-scoped)
          GBrain adapter sidecar (gbrain-adapter/, Bun)
                    |
                    v
          Durable PGLite retrieval store (chunks, FTS, optional embeddings)
```

The model receives **Breadboard-scoped tools**, never the raw GBrain tool
surface, MCP server, or admin operations.

## Trust boundary

* Every GBrain query carries a **server-derived** scope (user + authorized source
  ids). The model never supplies user ids, source ids, database names, paths, or
  credentials.
* Authorized gardens are re-derived from the short-lived capability token on every
  call. A model-supplied `gardenId` is **intersected** with that set; a
  non-authorized garden yields an empty scope (fail closed), not a leak.
* Internal GBrain source ids are **derived server-side** from the cluster id
  (`gbrain-src-cluster-<id>`). Guessing one grants nothing — authorization is
  checked against the mapping table, not the argument.
* Every returned citation is **validated against the authorized mapping** and
  dropped if it does not resolve to an authorized garden. A synthesized textual
  citation can never establish authorization.
* Adapter errors are collapsed to stable codes. Secrets, absolute paths, database
  configuration, and stack traces never cross to the browser or the model.

## Data ownership

Breadboard remains authoritative for users, auth, conversations, transcripts,
rolling summaries, durable memories, permissions, gardens, canonical markdown,
uploaded sources, proposals, artifacts, and audit records.

GBrain owns only **derived retrieval state**: chunks, embeddings, search indexes,
derived links, retrieval scores, and synthesized responses. The GBrain store is
never the canonical source of a garden page — `registerSource` always re-indexes
*from* canonical markdown.

## Source mapping

Server-controlled, in `dashboard/src/lib/gbrain/mapping.ts` +
`gbrain_garden_sources`:

```text
Breadboard user id
   -> authorized garden (cluster) id
   -> server-owned canonical content root (QUARTZ_CONTENT_PATH/<slug>)
   -> internal GBrain source id  (gbrain-src-cluster-<id>)
```

The content root is never supplied by the model.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `GBRAIN_MODE` | `disabled` | `disabled` (no adapter, no tools) / `preferred` (runs; degrades visibly) / `required` (dashboard reports failure honestly when unavailable). |
| `GBRAIN_ADAPTER_URL` | `http://127.0.0.1:7717` | Loopback adapter base URL. |
| `GBRAIN_ADAPTER_PORT` | `7717` | Adapter port (dev launcher / desktop). |
| `GBRAIN_ADAPTER_SECRET` | *(generated)* | Per-launch/per-install bearer secret. The dev launcher generates one and shares it with the dashboard; the browser never sees it. |
| `GBRAIN_DATA_DIR` | `~/.breadboard/gbrain` | Mutable PGLite/index data, **outside** the checkout. Desktop overrides to the userData dir. |
| `GBRAIN_EMBEDDING_PROVIDER` | `none` | `none` → honest `lexical_degraded`. `hash` → deterministic offline embedder enabling hybrid mode with no paid API. Real providers degrade to lexical when their key is missing. |
| `GBRAIN_EMBEDDING_MODEL` | *(empty)* | Optional model id for a real provider. |
| `GBRAIN_QUERY_TIMEOUT_MS` | `15000` | Bounded query timeout (client + adapter). |

## Development startup

```bash
# Off by default. Enable and run the whole stack:
GBRAIN_MODE=preferred npm run dev

# Or run just the adapter:
GBRAIN_MODE=preferred npm run dev:gbrain
```

`scripts/dev-all.mjs` starts the adapter **after ChatMock, before OpenHarness**,
generates a shared per-launch secret, polls `/health` with a bounded timeout, and
surfaces the reason on failure (fatal in `required`, non-fatal in `preferred`).

## Desktop behavior

The Electron supervisor (`desktop/src/main/service-definitions.ts`) registers a
`gbrain` service only when `gbrainMode !== "disabled"`:

* runs on the bundled `bun` runtime;
* loopback-only port (allocated in `app-lifecycle.ts`);
* per-install secret (`gbrainAdapterSecret` in `desktop-config.json`, redacted
  from logs);
* mutable data under `<userData>/Data/gbrain` — never in packaged resources;
* health-checked, gracefully shut down with the rest of the stack;
* `required: false` so it never blocks app startup — the dashboard reports a
  truthful degraded/unavailable state instead.

## Synchronization

* **Initial / on-demand:** `POST /api/gbrain/sync` (owner-only) reads a garden's
  canonical markdown via `scanClusterKnowledge`, builds index pages, and calls the
  adapter's `register-source` (idempotent full re-index). It never rewrites
  canonical markdown.
* **Incremental:** approving a proposal (`POST /api/gardens/[id]/proposals/[id]`,
  `decision: apply`) enqueues a sync job. Rejecting enqueues nothing, so the index
  is unchanged. A failed index marks the source **stale** (`gbrain_sync_state`) and
  never rolls back the canonical write.
* **Single-writer:** at most one queued/running job per source
  (`enqueueSyncJob`), respecting PGLite's single-writer model.

## Embedding configuration & degraded mode

The adapter reports `hybrid` only when a provider can actually produce vectors.
With `GBRAIN_EMBEDDING_PROVIDER=none` it runs lexical FTS and reports
`lexical_degraded` — truthfully, at every layer (adapter `/health`, the
`gbrain_status` tool, and `/api/gbrain/status`). Lexical-only retrieval is never
labeled hybrid.

## Adapted skills

`openharness-skills/breadboard-gbrain/` — eight **general-knowledge** skills, all
read-only or proposal-only, none activating coding mode or GBrain writes:
garden-research, cross-source-synthesis, capture-to-garden,
source-ingestion-guidance, meeting-ingestion, citation-audit, frontmatter-guard,
knowledge-health. The full upstream GBrain skillpack (cron, daily-task, dream
cycle, skill-creator, gstack coding, schema mutation, direct capture/enrich/
publish) is deliberately **not** installed — see the manifest's
`excludedUpstreamSkills`.

## Tools exposed to OpenHarness

`openharness-config/tool/gbrain.ts` (Garden Chat + Terminal only, never Quartz):

| Tool | Internal op | Purpose |
|---|---|---|
| `gbrain_status` | status | configured/healthy/degraded/unavailable/disabled |
| `gbrain_search` | search | hybrid retrieval with citations (read-only) |
| `gbrain_retrieve` | retrieve | fetch one page by citation id (read-only) |
| `gbrain_synthesize` | synthesize | extractive multi-source synthesis + citations |
| `gbrain_connections` | graph_neighbors | bounded related pages |

No capture, import, delete, schema admin, source admin, cron, shell, GBrain admin,
unrestricted file reads, or direct markdown mutation is exposed.

## Citation format

`BreadboardCitation` (`dashboard/src/lib/gbrain/types.ts`): `{ gardenId,
gardenName?, pageSlug?, title, path?, excerpt?, score? }`. `path` is
garden-relative (`/<gardenId>/<pageSlug>`), never an absolute disk path. Internal
source ids and retrieval internals never appear.

## Failure recovery

* Adapter down → tools return an honest "unavailable" message; Breadboard garden
  tools remain available; no un-grounded fallback is presented as grounded.
* Index failure → source marked stale, retry via `POST /api/gbrain/sync`.
* `required` mode makes failures loud; `preferred` degrades visibly.

## Security assumptions

* The adapter binds only to `127.0.0.1` and requires a bearer secret ≥ 8 chars; it
  refuses to start without one.
* The internal route (`/api/openharness/tools/gbrain`) authenticates with the same
  short-lived HMAC capability token as the garden tools; there is no browser API.
* GBrain results/skills/citations can never widen scope, grant filesystem/shell
  access, activate `scoped_implementation`, or authorize writes.

## Test commands

```bash
npm run test:gbrain          # adapter unit + server + durability (Bun)
npm run test:dashboard       # dashboard suite incl. GBrain trust-boundary tests
# End-to-end (spawns Bun adapter):
cd dashboard && BREADBOARD_TEST_GBRAIN_E2E=1 \
  node --test --experimental-strip-types tests/gbrain-e2e.test.mjs
cd desktop && npm test       # desktop supervisor incl. GBrain service test
```

## Versioning & vendored source

* Vendored GBrain: `gbrain/VERSION` = `0.42.62.0`, committed inside Breadboard at
  repo commit `9dbd2290…` (no separate upstream `.git`, so an upstream revision
  cannot be independently proven — see limitations).
* **No modifications** were made to `gbrain/src/`. The adapter does not import the
  full vendored engine; it implements a narrow, first-party PGLite retrieval store
  behind the adapter contract (see limitations for why).

## Current limitations

1. **The adapter does not yet import GBrain's full vendored engine.** Standing up
   GBrain's ~90-operation schema/engine was out of scope for the initial durable
   slice. The adapter implements exactly the retrieval Breadboard needs on PGLite,
   behind a stable contract, so the vendored engine can be swapped in later without
   changing the dashboard. `dashboard/.../gbrain-status.ts` (the older MCP-probe
   view) is superseded by `/api/gbrain/status` for the adapter path.
2. **Real (paid) embedding providers are not wired.** `none` and the deterministic
   `hash` provider are implemented; `openai`/`voyage`/etc. degrade to lexical.
3. **Sync job draining is manual/route-triggered** (`POST /api/gbrain/sync`
   `action: drain`); there is no always-on background worker yet.
4. **The product UI is minimal**: the status/sync signals are exposed via
   `/api/gbrain/status` and `/api/gbrain/sync`; a dedicated chat-panel badge is a
   follow-up.
5. **Upstream GBrain revision is unprovable** because the source is committed
   inside Breadboard rather than pinned as a submodule/package.
