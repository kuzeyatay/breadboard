# Hermes conversation and memory architecture

Breadboard owns conversation identity, persistence, authorization, and memory
policy. Hermes executes a conversation, but its internal session history is
not the durable or user-visible source of truth.

> **Conversation memory is not GBrain.** This document describes conversation
> memory (transcripts, rolling summaries, durable cross-chat memories) — *"what
> happened in this conversation or project?"*. GBrain (see
> `docs/GBRAIN_INTEGRATION.md`) is a separate, additive layer answering *"what
> knowledge exists in the authorized garden sources?"*. Chat messages, summaries,
> preferences, and capability decisions are **never** written into GBrain. Both
> may contribute context to a turn, but they remain separate and independently
> auditable.

## Architecture

```text
Terminal ---------\
Garden Chat -------+--> authenticated conversation API
Quartz AI --------/          |
                              +--> canonical transcript
                              +--> rolling summary + working state
                              +--> ranked durable memories
                              +--> one conversation-owned Hermes runtime
                              |         |
                              |         +--> short-lived capability
                              |                   |
                              |                   +--> authorized garden tools
                              |
Anonymous Quartz ------------+--> isolated anonymous runtime only
```

The server-owned hierarchy is:

```text
User
|- global durable memories (weak and selective)
|- project/garden durable memories (scoped and selective)
`- conversations
   |- canonical transcript
   |- rolling summary
   |- structured working state
   `- primary Hermes runtime
```

## Conversation and runtime ownership

`conversations` is the surface-independent chat entity. Its integer `id` is an
internal database key. Browsers and URLs use a random `conv_...` `public_id`, and
every read or write resolves that identifier together with the authenticated
user id. A conversation may have an optional default garden, but it never
requires or belongs to a garden.

`hermes_runtime_sessions.conversation_id` binds at most one active runtime
row to a conversation. Moving one conversation between Terminal, Garden Chat,
and authenticated Quartz therefore reuses the same primary Hermes session.
A different conversation receives a different runtime and transcript.

The runtime row's `surface`, `cluster_id`, `garden_id`, and `page_slug` fields are
last-active context, not ownership. The turn service replaces all of them on
every request, including replacing them with `NULL` for a Terminal turn. This
prevents a garden or page from leaking into a later unrelated request.

If the external runtime is missing or invalid, Breadboard replaces its external
session identity, reapplies MCP and capability configuration, and hydrates the
new runtime from the same summary, working state, recent exact messages, and
ranked durable memories. The canonical transcript remains intact.

## Canonical transcript and turn lifecycle

`conversation_messages` is the authoritative transcript. Every message records
its conversation, client message id, role, originating surface, content, status,
order index, timestamps, and optional source/usage/metadata payloads.

Authenticated clients send one new message with an opaque conversation id and a
`clientMessageId`; they do not send an authoritative copy of earlier history.
Inside an SQLite `IMMEDIATE` transaction the server:

1. verifies ownership and validates active garden/page context;
2. reserves adjacent user and pending-assistant order indexes;
3. rejects a different concurrent turn while an assistant row is pending;
4. deduplicates a retry using `(conversation_id, client_message_id, role)`;
5. dispatches the unified, server-composed turn;
6. completes, fails, or aborts the reserved assistant row exactly once.

The conversation row owns an atomic `next_order_index`. Database uniqueness
constraints protect both message identity and ordering. A failed turn remains
visible and may be retried explicitly with the same client message id. A stream
disconnect is recorded as aborted. Course corrections are inserted before the
pending assistant response with deterministic reindexing.

Where an old garden chat binding still exists, canonical writes are temporarily
dual-written to the legacy message table. New readers use the canonical store.

## Memory hierarchy and precedence

Every authenticated turn receives a bounded bundle in this order of authority:

1. current user instruction;
2. recent exact statements in the current conversation;
3. current conversation structured working state and rolling summary;
4. current tool and source evidence;
5. explicitly confirmed durable memory;
6. conservatively extracted candidate durable memory.

The latest user instruction always wins. Memory is labeled as untrusted context:
it cannot grant a tool, filesystem, garden, or mutation permission.

Recent exact history is limited to 24 messages. The bundle includes one rolling
summary, one structured state document, and at most six relevant durable
memories. Other chat transcripts are never injected.

The structured state tracks the current goal, known facts, decisions, completed
actions, open questions, referenced gardens/pages/files, and temporary
preferences. Active garden and page annotations are updated from server-validated
turn context.

## Durable cross-chat memory

`durable_memories` stores atomic preference, project fact, decision, or working
pattern records. Each item has a global, project, or garden scope; confidence;
salience; state (`candidate`, `confirmed`, or `superseded`); optional stable key;
and source conversation.

Retrieval uses deterministic lexical relevance multiplied by scope, confidence,
salience, state, and recency factors. The scope weights are:

| Context | Weight |
| --- | ---: |
| Current conversation exact history | 1.00 |
| Current project durable memory | 0.55 |
| Current garden durable memory | 0.45 |
| Global user durable memory | 0.25 |
| Otherwise related durable memory | 0.10 |

Items with no query overlap receive no score. A strict threshold and six-item
limit prevent memory existence alone from causing injection. Exact current-chat
messages are composed before durable items and the precedence statement is part
of the runtime context.

Every active row is scored; there is no recency window in front of relevance.
The recency factor decays from the latest of when a memory was stated,
confirmed, or last selected for a prompt. Retrieval stamps the rows that reach
a prompt (`last_retrieved_at`, `retrieval_count`) — once per turn, with the
final selection, whichever channel produced it — so a memory the user's
questions keep needing stays fresh and one nothing has needed decays to the
floor. A short follow-up that carries too few terms to match anything borrows
the most recent user turns as its retrieval query, and a small standing set of
confirmed global preferences rides along on every personalized turn.

An explicit “remember” request creates a confirmed item. Conservative stable
decision phrases may create candidates. Temporary task details, permissions,
filesystem grants, secrets, API keys, raw attachment bodies, unresolved advice
requests, and personal deliberations are not promoted. A user instruction such
as “don't store this in memory” blocks every write path for that turn, including
`save_memory` and mem0 extraction; the extraction model is not called at all.
When a stable memory key changes, the old active record is marked `superseded`
rather than left as a conflicting fact. A writer may instead ask for the row to
be rewritten in place (`onKeyConflict: "replace"`); the autofetch heartbeat
does, because a changed task count is a new reading of the same fact rather
than a prior belief worth keeping, and it deletes any retired rows carrying its
own `autofetch:` prefix.

## Rolling compaction

Compaction runs inside `completeAssistantMessage`, the one place every finished
answer lands regardless of surface or runtime, so Terminal, Garden Chat, the
provider-only path, and external-agent turns all reach it. A compaction failure
is logged and never fails the answer.

When more than 28 messages remain unsummarized, Breadboard summarizes the older
portion while retaining the most recent 18 messages exactly. It records the
highest included `order_index` and uses the memory-state version in a compare-and-
swap update, so the same range is not repeatedly summarized and racing turns
cannot overwrite newer state.

Compaction retains goals, confirmed decisions, completed actions, open questions,
references, and temporary preferences. Obvious secrets are redacted and a newer
decision replaces an obsolete overlapping decision. Opted-out and unresolved
deliberation prompts are excluded from this compact state. Runtime recreation
reads this compact state plus recent exact history.

## Garden authorization and mutation policy

The server derives `allowed_garden_ids` from gardens the authenticated user owns
or may access. It never accepts that authorization set from the browser or
model. A short-lived HMAC capability contains the internal user and conversation
ids, allowed tools, the allowed garden set, and an optional active-garden hint.

`garden_list` returns only rows in that signed set. Other garden tools require an
explicit garden where necessary, resolve a slug to its database id, and then
intersect it with the signed numeric set. A model-provided slug or id cannot
widen access. The active garden merely influences relevance.

Read tools may work across the authorized set. Writes remain typed note,
page-revision, or visualization proposals for user review. Conversation or
durable memory never becomes authorization.

## Authenticated and anonymous Quartz

Authenticated Quartz accepts an owned opaque conversation id, delegates to the
same turn service as Terminal and Garden Chat, replaces active garden/page
context, writes the canonical transcript, and reuses the conversation runtime.
It can receive current-chat context and weak ranked durable memory.

Anonymous Quartz retains the existing browser-token-bound numeric runtime path.
It cannot resolve an authenticated `conv_...` id, load private transcript or
durable memory, mint private-garden capabilities, or promote visitor content.
Authentication—not the surface name—selects the branch.

## Migration and compatibility

The schema migration is additive and repeatable:

1. create canonical conversation, message, memory-state, and durable-memory
   tables and indexes;
2. add conversation/canonical-message compatibility columns to existing tables;
3. backfill one canonical conversation per authenticated legacy chat or eligible
   runtime, preserving title, message order, content, and timestamps;
4. bind the most recent compatible runtime and initialize its authorized garden;
5. use stable legacy bindings and canonical-message ids to avoid duplicates when
   the migration runs again;
6. dual-write compatibility records while retained legacy readers exist;
7. route all authenticated interactive surfaces to canonical readers.

Anonymous runtime rows are deliberately excluded from private conversation
backfill. Legacy tables are retained; removal is a later cleanup migration only
after compatibility mode and all old readers are retired.

## Failure and recovery behavior

- Duplicate client delivery returns the already reserved or completed turn.
- A second distinct turn is rejected while one assistant row is pending.
- Permission-blocked turns are stored as failed/awaiting approval and retry with
  the same ids after approval.
- Stream completion persists the canonical assistant before marking the run
  finished; silent end-of-stream is failure, not success.
- Abort and disconnect set the pending assistant status to `aborted`.
- Runtime loss creates a replacement runtime and rehydrates canonical memory.
- Summary updates are versioned and advance only over a known message range.
- Persistence failures are audit events rather than silently accepted state.

## Primary implementation locations

- `dashboard/src/lib/conversations/schema.ts`: additive schema and backfill
- `dashboard/src/lib/conversations/store.ts`: ownership, transcript, ordering,
  idempotency, status transitions, and compatibility writes
- `dashboard/src/lib/conversations/memory.ts`: compaction, promotion,
  supersession, ranking, and prompt-safe context
- `dashboard/src/lib/conversations/turn-service.ts`: unified authenticated turn
- `dashboard/src/lib/hermes/session-service.ts`: conversation runtime and
  server-derived garden authorization
- `dashboard/src/lib/hermes/capability-token.ts` and `garden-tools.ts`:
  signed authorization boundary
- `dashboard/src/app/api/hermes/sessions/` and `dashboard/src/app/api/quartz-ai/`:
  authenticated APIs and the isolated anonymous Quartz compatibility branch
