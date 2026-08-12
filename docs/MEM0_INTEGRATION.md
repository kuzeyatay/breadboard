# mem0 semantic memory

Breadboard's durable memory could only find what the user's question happened
to share words with. `retrieveDurableMemories` scores by token overlap, so
"I prefer tabs over spaces" is invisible to "how should I indent this?" — and
because the SQL pre-filter takes only the 200 most recently touched rows, an
older memory is unreachable no matter how relevant it is.

mem0 (`../mem0`, the OSS engine vendored from `mem0-ts`) supplies the missing
channel. It is **additive**: `durable_memories` remains the canonical store,
the authority on what the agent knows, and the only thing the Settings → Memory
panel edits. mem0 holds a derived semantic index over the active rows.

> **This is not GBrain.** GBrain answers *"what knowledge exists in the
> authorized garden sources?"*. This layer answers *"what do I know about this
> user?"* — the same question `durable_memories` already answered, asked in a
> way that survives paraphrase. See `docs/HERMES_CONVERSATION_MEMORY.md` for
> the memory hierarchy this sits inside.

## What changed for the user

Two things, one on by default and one not.

**Recall by meaning** (default on). A turn's memory bundle is now built by
fusing two rankings: the deterministic lexical one, and mem0's semantic one.
A memory found by both outranks one found by either alone.

**Fact extraction** (default off, `BREADBOARD_MEM0_EXTRACTION=on`). After a
completed turn, mem0 reads the exchange and proposes atomic facts the user
never phrased as an instruction. Every proposal lands as a `candidate` at
confidence 0.42 — reviewable in Settings → Memory, ranked below anything
confirmed. **Extraction can never write a `confirmed` memory.** Only an
explicit user instruction or an explicit `save_memory` tool call does that.

## Architecture

```text
                    canonical                          derived
        +-------------------------------+    +--------------------------+
turn -> | durable_memories              |    | mem0 vector store        |
        |  content, kind, scope,        |<-->|  (SQLite, cosine scan)   |
        |  state, confidence, salience  |    +--------------------------+
        +-------------------------------+                ^
                    |                                    |
                    |            mem0_mirrors            |
                    +---- durable_id -> mem0_id, hash, --+
                          fingerprint
```

`mem0_mirrors` is the whole coupling: one row per mirrored memory, recording
which mem0 entry holds it, a hash of the content that was indexed, and the
embedding fingerprint (`model@dimension`) it was indexed under. Diffing canon
against that table is how every write path stays reconciled without any of
them knowing mem0 exists.

### The layer never becomes authority

Three properties, each with a test:

1. **A forgotten memory cannot come back.** Semantic hits are mapped back to
   canonical rows through a SQL join that re-checks
   `state IN ('candidate','confirmed')`. A stale index entry maps to nothing,
   so forgetting takes effect immediately rather than at the next reconcile.
2. **The same policy gates both channels.** Semantic hits are scored with the
   identical scope weight, state weight, confidence, salience, recency factor
   and score cutoff as lexical ones — `DURABLE_SCORE_CUTOFF` and
   `DURABLE_CANDIDATE_STATE_WEIGHT` are exported from `conversations/memory.ts`
   precisely so there is one copy. Memory existence alone still never reaches
   a prompt.
3. **Scope is enforced twice.** mem0 is filtered by an opaque `bb-user-<id>`
   tag, and the join is filtered by `user_id` again.

The composed prompt block is unchanged: same `# selective_weak_cross_chat_memory`
heading, same precedence policy, same six-item budget. The model is not told
which channel found a memory, because that would be a distinction without a
difference to it.

### Reconciliation

`reconcileSemanticMirrors` runs before each search, budgeted (24 items /
3 s) like the garden retriever's embedding backfill. A large backlog warms
over successive turns instead of stalling one, and a row with no vector still
ranks lexically — partial coverage degrades smoothly rather than lying.

Each pass, in order:

| Canonical change | How the pass sees it | Action |
| --- | --- | --- |
| Permanent delete | a row in `mem0_tombstones` | retire the vector |
| Forget / supersede | mirror joined to a `superseded` row | retire the vector, drop the mirror |
| Edit | `content_hash` mismatch | retire the old vector, index the new text |
| New memory | no mirror row | index it |
| Embedding model changed | `fingerprint` mismatch | index into the new store |

The tombstone table exists because permanent deletion is synchronous — the
Settings panel calls straight into SQLite — while retiring a vector is an
async call the user must not wait on, and `ON DELETE CASCADE` takes the mirror
row with its parent. A `BEFORE DELETE` trigger captures the mem0 id in the
same transaction, so the vector is retired on the next pass even if the
process dies in between.

Two durable rows with identical text share one mem0 entry (mem0 deduplicates
by exact hash), so a vector is only removed once no other mirror references it.

## Degradation

Every failure resolves to lexical-only, silently, because a working memory
system that finds less is strictly better than a broken turn:

- `BREADBOARD_MEM0=off`, or `BREADBOARD_EMBEDDINGS=off` — layer off.
- `mem0/mem0-ts` not built — the dynamic import fails, client is `null`.
- Embedding backend unreachable — reconcile stops spending budget; search
  returns null.
- Search exceeds 5 s — the deadline wins and the turn proceeds.

`hybridDurableMemories` returns `null` (not an empty array) whenever
lexical-only is the honest answer, so a caller can never mistake "the semantic
layer had nothing to add" for "there are no memories".

Quiet degradation is right for a turn and wrong for a settings page, so
Settings → Memory says which mode is in force — "Found by meaning" with index
coverage, or "Found by wording only" with the specific reason. That status
comes from `lib/mem0/status.ts` and rides on the existing `/api/agent-memory`
payload.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `BREADBOARD_MEM0` | on | `off` disables the layer |
| `BREADBOARD_MEM0_EXTRACTION` | off | `on` enables per-turn fact extraction |
| `BREADBOARD_MEM0_LLM_MODEL` | `default` | extraction model (ChatMock's global background model) |

Embeddings follow `lib/embeddings.ts` — by default ChatMock's keyless local
`local/bge-small-en-v1.5` (384-dim, ONNX on the CPU). No API key, no quota, no
external service. Point `BREADBOARD_EMBEDDING_MODEL` elsewhere and this layer
follows.

Storage lives beside `brain.db`, under `<database dir>/mem0/`:
`vector-store-<fingerprint hash>.db` and `history.db`. The vector store is
named by fingerprint because vectors from two models are not comparable and
mem0 hard-throws on a width mismatch — changing the embedding model opens a
fresh file rather than corrupting an existing one.

mem0's PostHog telemetry is disabled unless `MEM0_TELEMETRY` is set explicitly.

## The vendored engine

The clone gitignores its own `dist/`, so a fresh checkout has the sources but
no bundle — and without the bundle the layer silently stays off. Provisioning
is therefore part of starting Breadboard rather than a step you have to know
about: `npm run dev` runs

```bash
node scripts/setup-mem0.mjs --if-needed
```

as one of the stack's children, and the desktop build runs the same thing
before `next build` (tracing can only follow `import("mem0ai/oss")` into a
package that exists, so an unbuilt clone would ship a packaged app with no
semantic recall and no failing build step). `--if-needed` returns immediately
once the clone is built *and* the dashboard can resolve it, so it costs nothing
on every launch after the first.

The build is never waited on. Semantic recall stays lexical while it runs and
picks itself up on the next request — the Settings → Memory panel re-probes the
loader each time rather than caching a "not built" answer until restart.

`MEM0_AUTOSETUP=off` skips it. Repair a broken build with the unconditional form:

```bash
npm run setup:mem0
```

`mem0/mem0-ts` is built with `npx tsup` and linked into the dashboard as a
`file:` dependency (`mem0ai`). The dashboard imports `mem0ai/oss` — the
self-hosted engine — never `mem0ai` itself, which is the hosted platform
client and needs an API key.

Local embeddings additionally need ChatMock's `embeddings` extra
(`uv pip install --python chatmock/.venv/Scripts/python.exe "fastembed>=0.7,<1.0"`).
Without it `/v1/embeddings` answers 503 and this layer degrades to lexical.
The import is lazy, so installing it does not require restarting ChatMock.

Its configuration is entirely local: both the LLM and the embedder use mem0's
generic `openai` provider pointed at ChatMock via `baseURL`, the vector store
is mem0's `"memory"` provider (misleadingly named — it is better-sqlite3 on
disk, matching the dashboard's own v12), and the history store is its SQLite
manager. No Qdrant, no Docker, no cloud.

Two notes for anyone editing `lib/mem0/client.ts`:

- mem0's `add()`/`deleteAll()` take camelCase `userId`, but `search()`/
  `getAll()` **reject** top-level entity params and require snake_case
  `filters: { user_id }`. camelCase inside `filters` silently matches nothing.
  The upstream docs get this wrong; the source is authoritative.
- Building `mem0-ts` needs `@aws-sdk/client-bedrock-runtime` present for its
  `.d.ts` pass even though nothing uses Bedrock. The dashboard declares its own
  minimal ambient types in `src/types/mem0ai-oss.d.ts` rather than depending on
  the clone's declarations, so the ~25 optional provider SDKs stay uninstalled.

## Files

| Path | Role |
| --- | --- |
| `lib/mem0/config.ts` | flags, fingerprint, storage paths |
| `lib/mem0/client.ts` | the bridge to the vendored engine |
| `lib/mem0/schema.ts` | `mem0_mirrors`, `mem0_tombstones`, the trigger |
| `lib/mem0/mirror.ts` | budgeted reconciliation |
| `lib/mem0/retrieval.ts` | RRF fusion + the hybrid bundle |
| `lib/mem0/extraction.ts` | facts → durable candidates |
| `lib/mem0/conversation-extraction.ts` | the one-line completion hook |
| `lib/mem0/status.ts` | what Settings → Memory reports |

Wired at: `db.ts` (schema, after `ensureConversationSchema`),
`conversations/turn-service.ts` and `hermes/garden-chat-adapter.ts`
(hybrid bundle), `hermes/event-stream.ts` (extraction, beside the LoopX tick).

## Tests

- `tests/mem0-hybrid-memory.test.mjs` — 16 tests against a deterministic fake
  engine: fusion, cross-user isolation, forgetting, edit/supersede/delete
  reconciliation, budget, fingerprint change, secret rejection, degradation.
- `tests/mem0-live.test.mjs` — opt-in, needs ChatMock:
  `BREADBOARD_TEST_MEM0_LIVE=1 node --test --experimental-strip-types tests/mem0-live.test.mjs`.
  Proves the built bundle loads under Node on this platform and round-trips an
  entry through its SQLite vector store.
