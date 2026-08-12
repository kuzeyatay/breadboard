# OpenScience integration

`/agents:openscience` takes a research question and works it through: it reads
the literature, forms a hypothesis, writes and runs code, runs the experiment,
and reports what came out. The clone is
[synthetic-sciences/openscience](https://github.com/synthetic-sciences/openscience)
— an AI research workbench with a `research` harness, biology/physics/ML
specialists, ~290 skills, and around forty scientific databases (UniProt, PDB,
Ensembl, ChEMBL, PubChem, arXiv, OpenAlex, Semantic Scholar) exposed as tools.

It is a **wrapped runtime**: the clone is a real program with its own loop, so
Breadboard supplies the model and the chat, and the runtime does the work.

---

## What runs, and why it is not the clone

The clone is the **pinned version**, not the executable. Setup npm-installs
`@synsci/openscience@<version the clone ships>` into `dashboard/openscience-cli`,
and that platform build is what runs. Two reasons:

- **`bun install` in the clone is not reliably complete on Windows.** It
  silently drops files from extracted packages. After a clean install,
  `js-yaml@3.14.2` was missing all of `lib/js-yaml/type/js/` and
  `@opentelemetry/api` was missing `build/src/baggage/` — the CLI dies at import
  time on whichever it reaches first, and repairing a dependency tree package by
  package is not a setup step anyone can trust. The published tarballs contain
  the files; the extraction loses them.
- **Upstream publishes the same version as a platform binary**
  (`@synsci/openscience-windows-x64` and friends), so there is a supported
  artifact that needs no monorepo build.

The clone stays the source of truth for *which* version, and stays readable.
This is the same bargain HyperFrames and OfficeCLI already make.

> The clone's `master` runs ahead of the published version. Read it for
> orientation, but confirm runtime behaviour against the installed binary —
> `project/trust.ts` at HEAD returns "trusted" by default, and the shipped
> 2.0.22 returns "untrusted".

## Shape

```
lib/openscience/identity.ts     command, id, name, parser, user message
lib/openscience/runtime.ts      paths, pinned-version resolution, availability
lib/openscience/setup.ts        the npm install and the workspace, on a button
lib/openscience/config.ts       the configuration Breadboard writes
lib/openscience/service.ts      the supervised server, started once and reused
lib/openscience/client.ts       the server's HTTP API
lib/openscience/prompt.ts       harness choice and the run instruction
lib/openscience/run-manager.ts  runs, events, deliverables, terminal result
api/openscience/…               runs, events, abort, deliverables, health, setup
```

A run is driven through the runtime's **HTTP server**, not its `run`
subcommand. `run --format json` looks like the easy path and is not: its event
projection only reports tool calls that *succeeded*, so a denied shell shows up
as an agent that mysteriously stopped; it has no way to answer a permission
request; it asks questions on a terminal nobody is attached to and blocks
forever; and it cannot grant the workspace trust. The server exposes the whole
event stream and takes responses over HTTP.

The server is started lazily on the first run and reused. Boot is slow — it
loads the skill library, opens its storage and initialises the LSP layer — so
this is the difference between a 20-second and a 2-second second run. It is
restarted only when the config it booted with no longer matches what a run needs
(a different ChatMock target, or a model the config does not declare).

---

## Five things that each cost a failing run

These are the whole integration. Each was found by watching a run fail in a way
that pointed somewhere else.

### 1. The provider must be `@ai-sdk/openai`, not `@ai-sdk/openai-compatible`

ChatMock's native protocol is the Responses API; `/v1/chat/completions` is a
translation on top of it, and it reports `finish_reason: "stop"` on a response
that carried tool calls. The agent loop reads that as "the model is done" and
ends the turn after **one** tool call — the agent announces what it is about to
do, writes a single file, and stops. It reads like a lazy model.

Pointed at `/v1/responses` the same task runs the full multi-step loop
(`finish_reason: tool-calls` repeatedly, six steps instead of one).

This is a ChatMock bug and it is not fixed here — `routes_openai.py` hardcodes
`"finish_reason": "stop"` on the non-streaming path even when `tool_calls` is
populated, and the streaming path emits a `stop` chunk after the `tool_calls`
one. Any OpenAI-compatible agent runtime on ChatMock's chat-completions endpoint
inherits it.

### 2. Every model must declare `tool_call: true`

A custom provider gets no models.dev metadata, so capabilities come only from
what the config says. `session/llm.ts` sends **no tools at all** when
`capabilities.toolcall` is falsy, and the model then answers "I'll create the
script and run it" with nothing to create it with. Symptom and cause look
nothing alike.

### 3. The sandbox has to be disabled, in the *global* config

The execution sandbox is macOS Seatbelt / Linux bubblewrap only. On Windows
there is no backend, and the default `onUnavailable: "error"` denies every
shell, kernel and job capability — the agent writes a script and then reports
that it was not allowed to run it.

Sandbox policy is read from **global + managed config only**; a project's own
`openscience.json` is deliberately ignored so an untrusted repo cannot weaken a
machine-wide boundary. Breadboard's config directory is that global config,
which is the only reason this is settable at all.

### 4. The workspace must be its own root twice over — `.git` *and* `package.json`

OpenScience resolves a project by walking up to the nearest VCS root. In
development the workspace lives inside the Breadboard repository, so without its
own `.git` the project root becomes **the whole of Breadboard** — the agent's
write roots and its trust decision come to cover this repository rather than its
own directory.

`.git` alone is not enough, and this one bit during this integration's own
verification. npm and bun find their project by walking up for a
`package.json`, not a VCS root. A research run reached for `bun install`,
found no manifest in the workspace, climbed out to `dashboard/package.json`,
and installed Breadboard's dependencies over the top of themselves — which
replaced the compiled `better-sqlite3` binding with nothing and broke every
database-backed test in the repository until `npm rebuild better-sqlite3`
restored it.

`ensureWorkspace()` therefore writes both a `.git` and a private
`package.json`, and setup reports whether the workspace is isolated. If a
future run ever escapes anyway, that is the shape of the symptom: unrelated
tests failing on a missing native module.

### 5. A fresh project is untrusted, and untrusted means no process at all

`ExecutionAuthority` refuses `shell`, `kernel`, `local_job` and the rest for an
untrusted project. The failure surfaces as `ExecutionAuthorityDeniedError`
inside a tool result — invisible in the CLI's JSON output, which is how this one
hid for three runs.

`service.ts` grants trust over the API once, on the root the server itself
reports. The server refuses any other root, so this cannot widen past the
directory Breadboard made for it.

### Bonus: keep the state directory shallow

OpenScience writes each session through a temp file named
`<session>.json.<pid>.<uuid>.tmp`. Under a deep root that path passes Windows'
limit and every session creation fails with `ENAMETOOLONG`, which the CLI
surfaces only as `Error: Session not found`. `tests/openscience-agent.test.mjs`
asserts the headroom.

---

## Permissions

The runtime's own defaults allow the ordinary tools and ask only for the three
that reach outside the turn's own work. An unattended run answers them itself:

| Permission | Answer | Why |
| --- | --- | --- |
| `external_directory` | reject | A workspace-scoped research run has no business reading elsewhere. |
| `mcp` | reject | Breadboard configures no MCP servers for this agent. |
| anything else (e.g. `doom_loop`) | allow once | Refusing the loop guard would kill a long but legitimate experiment. |

A refusal is emitted as an event and named in the run card, so a run that was
kept inside its workspace says so rather than looking like it gave up.

Questions are denied twice over — in the written config and on each session —
because `question.asked` has no answerer here and the runtime waits indefinitely
rather than failing.

## Deliverables

The workspace is durable and shared across runs, so a run reports only what it
added: the file list is snapshotted before the turn and diffed after, ignoring
`.git`, `node_modules`, `__pycache__` and the various tool caches. Files appear
in the card as the run works, and download through
`/api/openscience/runs/<runId>/deliverables?path=…` — which serves only paths
that run reported, and only from inside its workspace.

## Settings

Two, in `CONFIGURABLE_AGENTS`:

- **How it works** — `research` (writes code, runs experiments) or `plan`
  (investigates without changing anything). Only the runtime's *primary* agents
  are offered: biology, physics and ml are subagents, which the runtime refuses
  as a primary agent and silently replaces, so offering one would be a lie. The
  research harness delegates to them on its own.
- **Keep what it makes** — whether produced files are attached to the answer.

## Verifying it

The runtime was exercised end to end against a live ChatMock before this
shipped: asked for a script that iterates the logistic map, it wrote
`logistic.py`, ran it with Python, wrote `results.txt`, read the file back and
reported the ten values. Shell execution, multi-step tool use, file creation and
token accounting are all confirmed on real runs, not stubs.

`tests/openscience-agent.test.mjs` covers the parser, the settings translation,
the config contract above, the instruction, and the path-containment refusal.
The shared `tests/external-agent-persistence.test.mjs` covers the run card's
survival across a reload for free, because the kind is in the registry.
