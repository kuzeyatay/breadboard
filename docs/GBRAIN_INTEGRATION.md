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
          GBrain adapter sidecar (gbrain-adapter/, Node 24)
                    |
                    v
          VENDORED GBrain engine (gbrain/src, PGLite) via public ops
```

## Backends

The adapter selects a retrieval backend by `GBRAIN_BACKEND`:

* **`gbrain` (production default)** — `gbrain-adapter/src/backends/gbrain-backend.ts`
  wraps the vendored GBrain engine through its public interfaces: `createEngine`
  (`engine-factory`), `connect`/`initSchema`/`disconnect`, `addSource`
  (`sources-ops`), `importFromContent` (`import-file`: parse + chunk + embed),
  `searchKeyword` + `searchVector`, `embedQuery`, `getPage`, `getLinks` /
  `getBacklinks`, `addLinksBatch`, `deletePages` / `getAllSlugs`. The only
  non-op access is `engine.executeRaw` for `count(*)` stats — a public engine
  method used throughout gbrain core.
* **`fake` (test-only)** — `gbrain-adapter/src/store.ts`, a deterministic
  first-party PGLite store. It is **never** the default, is **refused** in
  packaged production (`GBRAIN_PACKAGED=1` / `NODE_ENV=production`) unless
  `GBRAIN_TEST_MODE=1`, and reports `backend: "fake"` in `/health` — it never
  masquerades as GBrain.

`/health` and `/api/gbrain/status` surface `backend` truthfully.

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

The "Default" column is what you get when the variable is unset and Breadboard is
started the normal way (`npm run dev`, `npm run dev:gbrain`, or the desktop app).
The embedding defaults are supplied by those launchers, not by the adapter binary.

| Var | Default | Meaning |
|---|---|---|
| `GBRAIN_MODE` | `preferred` | `disabled` (no adapter, no tools; must be asked for explicitly) / `preferred` (runs; degrades visibly) / `required` (dashboard reports failure honestly when unavailable). |
| `GBRAIN_ADAPTER_URL` | `http://127.0.0.1:7717` | Loopback adapter base URL. |
| `GBRAIN_ADAPTER_PORT` | `7717` | Adapter port (dev launcher / desktop). |
| `GBRAIN_ADAPTER_SECRET` | *(generated)* | Per-launch/per-install bearer secret. The dev launcher generates one and shares it with the dashboard; the browser never sees it. |
| `GBRAIN_DATA_DIR` | `~/.breadboard/gbrain` | Mutable PGLite/index data, **outside** the checkout. Desktop overrides to the userData dir. |
| `GBRAIN_BACKEND` | `gbrain` | `gbrain` (real vendored engine) or `fake` (test-only, refused in packaged production). |
| `GBRAIN_EMBEDDING_PROVIDER` | `openai-compatible` | `none` → honest `lexical_degraded`. `openai-compatible` → real embeddings via any OpenAI-compatible endpoint. `deterministic-test` → reproducible offline embedder (rejected unless `GBRAIN_TEST_MODE=1`). |
| `GBRAIN_EMBEDDING_BASE_URL` | `<ChatMock>/v1` | OpenAI-compatible embeddings endpoint (routed through GBrain's native `openai:` provider). |
| `GBRAIN_EMBEDDING_API_KEY` | `local` | Embeddings API key. Missing → truthful `lexical_degraded`. Never reaches the browser or audit metadata. |
| `GBRAIN_EMBEDDING_MODEL` | `local/bge-small-en-v1.5` | Embedding model id (without provider prefix). |
| `GBRAIN_EMBEDDING_DIMENSIONS` | `384` | Embedding dimension. Must match the model; mismatches fail clearly at ingest via GBrain's own dim check. |
| `GBRAIN_QUERY_TIMEOUT_MS` | `15000` | Bounded query timeout (client + adapter). |

## Development startup

```bash
# On by default (`preferred`) - the whole stack starts the adapter:
npm run dev

# Or run just the adapter:
npm run dev:gbrain

# Turn it off for a run:
GBRAIN_MODE=disabled npm run dev
```

`scripts/dev-all.mjs` starts the adapter **after ChatMock, before Hermes**,
generates a shared per-launch secret, polls `/health` with a bounded timeout, and
surfaces the reason on failure (fatal in `required`, non-fatal in `preferred`).

## Runtime V2 desktop lifecycle

The checked-in Runtime V2 source registers `gbrain` as a real, on-demand
service. It is absent at startup. The first retrieval acquires a server-side
lease; the Rust ledger single-flights concurrent cold requests, starts one
contained Node tree, waits for `/health` to prove the real `gbrain` backend, and
then resumes the original request. Query timeout accounting begins only after
that readiness lease has been acquired. A live lease prevents idle shutdown;
the final release starts a bounded 10-minute idle TTL, and later retrieval can
start a new generation.

Status and availability reads are observational: they do not acquire a lease,
start the adapter, or remove the GBrain agent/tool surface. Resource-admission
denials and adapter unavailability cross the existing UI as bounded structured
errors. The renderer receives neither the service token nor any executable,
path, or environment authority.

The manifest's `requirement: optional` is failure-isolation policy, not optional
capability registration: a GBrain launch failure may not prevent unrelated
Breadboard surfaces from opening, but GBrain remains registered and visible and
its next real retrieval can acquire a new lease.

The Rust-owned environment preserves the existing per-install adapter secret,
ChatMock embedding endpoint/model settings, and mutable
`<userData>/Data/gbrain` store. The adapter and vendored engine are staged as
immutable app source with frozen production dependencies; PGLite data and model
caches are never copied into packaged resources.

This is currently an adapter-ready source implementation, not the active
desktop owner. Until `AppLifecycle` selects `RuntimeProcess` as the sole process
owner, the existing Electron definition in
`desktop/src/main/service-definitions.ts` remains the explicit legacy baseline.
Runtime V2 mode is guarded from selecting that definition as a fallback. The
central shell cutover must delete it once RuntimeProcess activation and parity
are proven; it must not remain as a second supervisor.

## Synchronization

* **Initial / on-demand:** `POST /api/gbrain/sync` (owner-only) reads a garden's
  canonical markdown via `scanClusterKnowledge`, builds index pages, and calls the
  adapter's `register-source` (idempotent full re-index). It never rewrites
  canonical markdown.
* **Incremental:** approving a proposal (`POST /api/gardens/[id]/proposals/[id]`,
  `decision: apply`) enqueues a sync job. Rejecting enqueues nothing, so the index
  is unchanged. A failed index marks the source **stale** (`gbrain_sync_state`) and
  never rolls back the canonical write.
* **Always-on worker:** `dashboard/src/lib/gbrain/sync-worker.ts` drains the queue
  automatically — no manual `drain` call is required. It atomically claims jobs,
  runs at most one per garden at a time, recovers jobs abandoned by a crashed
  worker (stale-claim requeue), applies bounded exponential backoff, records
  attempt counts + final error codes, and stops cleanly (awaits the in-flight job)
  on shutdown. It never full-reindexes on startup — it only processes enqueued
  jobs. Started lazily whenever a GBrain route or a proposal-apply runs (no-op when
  disabled).
* **Single-writer:** at most one queued/running job per source
  (`enqueueSyncJob`), respecting PGLite's single-writer model.

## Embedding configuration & degraded mode

The adapter reports `hybrid` only when a provider can actually produce vectors.
With `GBRAIN_EMBEDDING_PROVIDER=none` it runs lexical FTS and reports
`lexical_degraded` — truthfully, at every layer (adapter `/health`, the
`gbrain_status` tool, and `/api/gbrain/status`). Lexical-only retrieval is never
labeled hybrid.

## Adapted skills

`hermes-skills/breadboard-gbrain/` — eight **general-knowledge** skills, all
read-only or proposal-only, none activating coding mode or GBrain writes. Only
three are **user-visible** in the palette (garden-research, capture-to-garden,
knowledge-health); the other five are **internal** routing skills
(cross-source-synthesis, source-ingestion-guidance, meeting-ingestion,
citation-audit, frontmatter-guard) — still available to the authenticated Garden
Chat and Terminal agents but hidden from the palette to avoid clutter. The full
upstream GBrain skillpack (cron, daily-task, dream cycle, skill-creator, gstack
coding, schema mutation, direct capture/enrich/publish) is deliberately **not**
installed — see the manifest's `excludedUpstreamSkills`.

## Tools exposed to Hermes

`hermes-config/tool/gbrain.ts` (Garden Chat + Terminal only, never Quartz):

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
* The internal route (`/api/hermes/tools/gbrain`) authenticates with the same
  short-lived HMAC capability token as the garden tools; there is no browser API.
* GBrain results/skills/citations can never widen scope, grant filesystem/shell
  access, activate `scoped_implementation`, or authorize writes.

## Test commands

```bash
# Adapter: Bun compatibility suite plus the production Node transport/loader and
# REAL vendored-engine end-to-end (lexical, vector, graph, synthesis, isolation,
# durability). Requires `bun install` in gbrain/ first (see note below).
npm run test:gbrain

# Dashboard: full suite incl. GBrain trust-boundary, citations, tool scopes,
# skill visibility, sync-worker, and status-badge tests.
npm run test:dashboard

# Opt-in GBrain e2e over the dashboard boundary (starts the Node adapter):
cd dashboard && BREADBOARD_TEST_GBRAIN_E2E=1 \
  node --test --experimental-strip-types tests/gbrain-e2e.test.mjs

# Opt-in live embedding provider:
GBRAIN_LIVE_EMBED=1 GBRAIN_EMBEDDING_BASE_URL=... GBRAIN_EMBEDDING_API_KEY=... \
  GBRAIN_EMBEDDING_MODEL=... GBRAIN_EMBEDDING_DIMENSIONS=... \
  bun test ./gbrain-adapter/test/embedding-config.test.ts

cd desktop && npm test       # desktop supervisor incl. GBrain service test
```

> **Note (Bun + OneDrive):** the vendored engine needs `gbrain/node_modules`.
> On a OneDrive-synced checkout, Bun's default global cache can produce
> incompletely-extracted packages; install with an out-of-OneDrive cache:
> `cd gbrain && BUN_INSTALL_CACHE_DIR=%TEMP%\bun-gbrain-cache bun install --backend copyfile`.

## Versioning & vendored source

* Vendored GBrain: `gbrain/VERSION` = `0.42.62.0`. Full machine-readable
  provenance is in **`gbrain/UPSTREAM.json`** (declared version, tree checksums,
  local-patch list, and a reproducible comparison procedure).
* One narrow diagnostic patch is retained in `gbrain/src/core/pglite-engine.ts`
  so non-Error PGlite initialization failures preserve their own fields instead
  of becoming `[object Object]`; `gbrain/UPSTREAM.json` records the patch and its
  focused verification. The production backend still imports the vendored
  engine only through its public interfaces.
* The exact upstream commit SHA cannot be independently proven because the source
  is committed inside Breadboard (no submodule/pin). `UPSTREAM.json` records this
  honestly and gives a diff-against-tagged-release verification procedure.

## Current limitations

1. **Embeddings:** `none` (lexical) and `openai-compatible` (real) and
   `deterministic-test` (offline, test-only) are implemented. There is one opt-in
   live-provider test (`GBRAIN_LIVE_EMBED=1`); the default suite never calls a paid
   API. A dimension change on an existing brain requires a reindex — GBrain's own
   dim check fails clearly at ingest, but there is no pre-emptive re-embed sweep.
2. **Synthesis is extractive**, grounded in real GBrain retrieval. LLM-based
   synthesis (GBrain's `think`/query provider path) is deferred until a chat
   provider is configured for the adapter; the adapter never falls back to
   un-grounded model knowledge.
3. **Installed desktop smoke test:** GBrain lifecycle coverage is added to
   `desktop/scripts/smoke-test.mjs` (adapter health, real-engine backend, data
   dir under userData, fixture index, retrieval after restart, secret-absent-from-
   logs, no-orphan-process). It has **not been executed** in this environment
   because building/installing the packaged Windows app is out of scope here; the
   checks are gated to run when GBrain is enabled and record an explicit skip
   otherwise. See DESKTOP_TROUBLESHOOTING for how to run it.
4. **Upstream GBrain revision is unprovable** (committed in-tree, not a
   submodule/package) — see `gbrain/UPSTREAM.json`.
5. **`dashboard/.../gbrain-status.ts`** (the older MCP-probe view) is superseded
   by `/api/gbrain/status` for the adapter path and remains only for the legacy
   capability panel.
