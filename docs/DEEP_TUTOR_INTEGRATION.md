# Deep Tutor — Integration & Operations

A tutor that teaches from **your own material**. It explains, works problems
through, writes quizzes, researches, visualizes, and plans a mastery path — and
it remembers what you have covered, per subject, across conversations.

It is used like every other runtime agent — **no separate UI**. Pick it in the
capability palette's **Agents** tab (the `/` button), which inserts its command
into the composer, or type the command yourself:

```
/agents:deep-tutor explain aliasing and folding using my notes
/agents:deep-tutor --solve find the impulse response of this FIR filter
/agents:deep-tutor --quiz --count 8 sampling and reconstruction
/agents:deep-tutor --research --web what has changed in this field since 2024
```

While it is active every prompt in that conversation becomes a tutoring turn,
and each turn appears as a live card in the transcript (what it is reading, what
it looked at, then the answer). Clear the chip in the composer to hand the
conversation back to the chat model.

The engine is the [DeepTutor](https://github.com/HKUDS/DeepTutor) checkout in
`./DeepTutor` (its own git clone, not tracked by this repo). Its LLM runs
through **ChatMock**, the local gateway the chat surfaces already use, so a turn
needs no third-party key.

## What it can read — the whole point

Deep Tutor is scoped by **where you ask it**, not by what you type. A message
can narrow the scope (`--no-material`) but never widen it.

| Surface | Scope | How |
|:--|:--|:--|
| **Garden Chat** | That Garden's directory — its notes, folders and files | `quartz/content/<slug>`, ownership checked server-side |
| **Terminal** | The whole Breadboard workspace, plus every folder you have granted Hermes read access to | repository root + `hermes_filesystem_grants` |

Three mechanisms deliver it, and all three are Breadboard's:

1. **Eager material.** Before the first model call, Breadboard picks the files
   in scope that the question points at and attaches them, so the opening answer
   is already grounded. Relevance is lexical — filename first, then the note's
   own prose — because there is no embedding provider behind ChatMock and a
   vector store with nothing to fill it would be a dependency, not a feature.
   Garden Chat only; the workspace is far too large to preload usefully.
2. **Live browsing.** `scripts/deeptutor-files-mcp.mjs` is a read-only MCP
   server that gives the tutor `list_materials`, `read_material` and
   `search_materials`, rooted at the scope's directories. Everything is
   root-contained on the **real** path, so a symlink cannot step outside, and no
   tool writes anything.
3. **Retrieval.** A Garden is indexed into a DeepTutor knowledge base, which
   auto-mounts the `rag` tool for the turn. This is the one that finds a note
   whose words you did not use: "if I record a signal too infrequently, what
   goes wrong" retrieves the page on under-sampling and aliasing. See
   [Knowledge bases](#knowledge-bases).

MCP is the extension point on purpose: DeepTutor's chat loop mounts exactly one
surface for tools that are not its own built-ins, so this is the only way to
widen what a turn can see **without editing the clone**. The checkout stays
pristine and a `git pull` there never conflicts with Breadboard's files.

## Architecture

```
Garden Chat / Terminal
   │  /agents:deep-tutor …
   ▼
/api/deep-tutor/runs ─── resolveScope() ──► roots + eager material
   │                     provisionHome() ──► <home>/data/user/settings/*
   ▼
lib/deep-tutor/run-manager.ts
   │  spawn: DeepTutor/.venv/python scripts/deeptutor-bridge.py
   │  stdin: one JSON job     stdout: NDJSON events
   ▼
DeepTutor (the clone)
   ├── LLM ────────► ChatMock  (model_catalog.json, `custom` binding)
   └── MCP ────────► node scripts/deeptutor-files-mcp.mjs  (mcp.json, scoped roots)
```

### The tutoring home

DeepTutor keeps everything a lifelong tutor accumulates — sessions, its three
memory layers, notebooks, generated files — under one directory chosen by
`DEEPTUTOR_HOME`. Breadboard gives **each (user, scope) pair its own**:

```
.runtime/deep-tutor/u<userId>/garden-<slug>/
.runtime/deep-tutor/u<userId>/workspace/
```

So the tutor that teaches you inside the Signals Garden remembers Signals, and
the Terminal tutor remembers your workspace. One shared home would blend them; a
per-conversation home would forget you between chats. `breadboard-session.json`
in each home is the pointer to the DeepTutor session the conversation continues
— which is why the second question is a follow-up and not a fresh start.
`--fresh` drops it; **Forget this scope** in the settings dialog deletes the
whole home.

Everything under `settings/` is generated before every run, because everything
in it depends on the request: `model_catalog.json` (the chat's model, on
ChatMock), `main.yaml`, `interface.json` (language), `mcp.json` (this scope's
roots). Anything DeepTutor itself writes into the home is left alone.

`main.yaml` turns console logging **off**, and that one is load-bearing:
DeepTutor's console handler is a `StreamHandler(sys.stdout)`, which is the
bridge's own channel. Nothing is lost — the reason a turn failed arrives as the
bridge's `failed` event, and a hard crash still puts its traceback on stderr.

## Knowledge bases

A Garden is indexed into a DeepTutor knowledge base, and naming that KB on a
turn is what auto-mounts `rag`. Retrieval is over vectors, so it answers the
question the file tools cannot: *which* of 74 notes bears on this, when the
question and the note share no vocabulary.

**Vectors come from ChatMock.** `/v1/embeddings` is new, and it is the reason
this works at all — before it, every embedding path in Breadboard needed a paid
key. `dashboard/src/lib/embeddings.ts` is now the single answer to "which model,
from where, with what key", shared with the Garden semantic retriever and the
GBrain sidecar, so all three index in the same vector space; see
[MODEL_PROVIDERS.md](MODEL_PROVIDERS.md#embeddings). Two backends:

- `local/<model>` runs in ChatMock's own process through **fastembed** (ONNX
  Runtime on the CPU). No key, no quota, no network after the first model
  download. Deep Tutor indexes with `local/bge-small-en-v1.5` (384-dim).
- `<provider>/<model>` relays to a configured provider's own `/embeddings`,
  reusing the chat credentials — `openai/text-embedding-3-small` needs no new
  config.

fastembed is an optional extra (`pip install -e '.[embeddings]'` in `chatmock`)
because it pulls ONNX Runtime and tokenizers. Without it, `/v1/embeddings`
answers 503 naming the install, Deep Tutor's health reports retrieval as
unavailable, and tutoring still works — it reads instead of retrieving.
Embedding models stay out of `/v1/models` on purpose: that list feeds the chat
pickers, where a vector model would be a model that produces no answer.

**Indexing never blocks a question.** A turn checks the index, starts a rebuild
if it is missing or stale, and goes ahead with the file tools; the *next*
question gets retrieval. Building a 74-note Garden takes a few minutes.

**Freshness is a manifest, not a timestamp** (`breadboard-index.json` in the
home): the file list with each one's size and mtime, plus the embedding model's
fingerprint. Any change makes the index stale, and a stale index is **never**
named on a turn — a tutor retrieving confidently from what a note no longer
says is worse than one that reads the file. Changing the embedding model
invalidates every index, because vectors from two models are not comparable.

Rebuilds are total rather than incremental: DeepTutor can add a document to a
live KB but cannot remove one, so an incremental index would keep citing notes
you deleted.

Only Gardens are indexed. The Terminal's scope is a whole workspace of mostly
code, where indexing would cost a great deal and retrieve mostly noise — there
the file tools are the right tool, not a fallback.

### The bridge

`scripts/deeptutor-bridge.py` runs one turn and reports NDJSON. It exists rather
than `deeptutor run` because the CLI cannot carry attachments or skills, and its
`--format json` is a raw passthrough of DeepTutor's internal protocol — dozens
of chunk events per round, with the answer spread across per-round buffers that
only settle when a later `call_status` marker names the round. The bridge does
the CLI's own aggregation (`TurnStreamRenderer`) minus the terminal, and emits
`started / stage / thinking / tool / block / note / sources / usage / ask /
completed / failed`. Nothing about the tutoring is reimplemented.

`ask_user` is auto-answered with an empty reply: nobody is at the keyboard, and
an unanswered question would hang the turn forever. The card says so when it
happens, because it explains an answer that suddenly hedges.

## Setup

Deep Tutor's environment is close to a gigabyte of Python, so **a run never
installs it**. Open the agent's settings from the palette and press **Build
environment**.

- **uv is required.** DeepTutor pins `>=3.11,<3.14` (its compiled wheels have no
  3.14 build), so on a machine whose only Python is newer, `python -m venv`
  produces an environment pip then refuses to install into. uv fetches a
  matching 3.12 itself.
- `--link-mode=copy` is not a preference: this repository commonly lives in a
  OneDrive folder, where uv's default hardlinking fails mid-install with *"the
  cloud operation cannot be performed on a file with incompatible hardlinks"*
  and leaves a half-built environment behind.
- The `mcp` client rides along in the same install. Without it the tutor starts
  fine and then cannot see a single file, so health reports it separately and
  the settings panel says **Cannot read files** rather than **Ready**.

## Flags

| Flag | Effect |
|:--|:--|
| `--solve` / `--quiz` / `--research` / `--visualize` / `--animate` / `--mastery` / `--explain` | Which capability runs. Default: tutoring chat. |
| `--cap <name>` | The same, by DeepTutor's own capability name. |
| `--count N` | Questions in a quiz (1–20). |
| `--web`, `--papers`, `--tool <name>` | Turn on web search, paper search, or a named tool. |
| `--no-material` / `--material` | Skip or force the eager material load. |
| `--fresh` | Start a new tutoring session instead of continuing this scope's. |
| `--lang xx` | Answer language. |

Anything unrecognized stays part of the question. Stored settings (palette →
Deep Tutor → settings) fill in only what a message leaves unsaid.

## Files

| Path | What |
|:--|:--|
| `scripts/deeptutor-bridge.py` | One turn → NDJSON. Breadboard's file, outside the clone. |
| `scripts/deeptutor-files-mcp.mjs` | Read-only, root-contained MCP file server. |
| `scripts/deeptutor-index.py` | Builds one knowledge base → NDJSON progress. |
| `chatmock/chatmock/embeddings.py` | Local + provider embedding backends. |
| `chatmock/chatmock/routes_embeddings.py` | `/v1/embeddings` and its model list. |
| `src/lib/deep-tutor/knowledge-base.ts` | Index freshness, and the background build. |
| `src/lib/deep-tutor/embeddings.ts` | Whether ChatMock can produce vectors. |
| `src/lib/deep-tutor/identity.ts` | Command, capabilities, flag parsing. |
| `src/lib/deep-tutor/materials.ts` | Scope resolution and eager material selection. |
| `src/lib/deep-tutor/home.ts` | The per-scope home and everything generated in it. |
| `src/lib/deep-tutor/run-manager.ts` | Spawns the bridge, translates its events. |
| `src/lib/deep-tutor/runtime.ts` | Clone/venv/script location and health. |
| `src/lib/deep-tutor/setup.ts` | Build / repair / remove the environment. |
| `src/app/api/deep-tutor/*` | runs, events (SSE), abort, health, setup. |
| `src/app/components/hermes/inline-deep-tutor-run.tsx` | The live card. |
| `tests/deep-tutor.test.mjs` | 21 tests. |

## Known limits

- **Answers need ChatMock to have quota.** A ChatGPT usage limit surfaces as a
  failed turn with the upstream message; nothing about the integration retries
  around it.
- **The eager selection is lexical.** It ranks filenames above prose and ignores
  wikilink titles (a generated Garden puts the same source backlink on every
  page, which otherwise made every page match every question). It will still
  miss a note that never uses the question's words — `search_materials` is the
  backstop, not a nicety.
- **Engine edits live in the clone.** There are none today, and that is
  deliberate: everything Breadboard needed went into `mcp.json` and two files in
  `scripts/`. Keep it that way, or a re-clone will drop them.
- **The first question after an edit does not retrieve.** Editing a note makes
  the index stale, and a stale index is skipped rather than trusted, so that
  turn reads files while the rebuild runs. This is deliberate; the alternative
  is confident retrieval from stale passages.
- **Indexing is CPU-bound and local.** A few minutes for a Garden of ~75 notes,
  on one core. It is not incremental (see above).
