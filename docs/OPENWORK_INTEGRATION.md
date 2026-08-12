# OpenWork workspace agent

`/agents:openwork <task>` does the work inside an OpenWork workspace — its
skills, its connected MCP servers, its files — and hands back the answer plus
anything the run left in the workspace outbox.

It is the one agent whose runtime Breadboard genuinely wraps rather than ports:
the cloned `openwork/` server is started as a real service and driven over its
own HTTP API.

## Why it is built this way

OpenWork is "an open-source alternative to Claude Cowork": a desktop app and a
control plane for running agents against a workspace of skills, plugins and MCP
connections. Three of its four parts are not usable here, and the fourth is:

| Part | Verdict |
| --- | --- |
| Desktop app (Electron) | Redundant — Breadboard is already the shell |
| Den control plane | Hosted, needs an openworklabs.com organization |
| Capability marketplace (`search_capabilities` / `execute_capability`) | Hosted — the app is a *client* of `api.openworklabs.com/mcp/agent`, so it is not local |
| **`apps/server`** | **A real, self-contained local runtime — this is what is wrapped** |

The server owns workspaces, skills, MCP connections, approvals, sessions and an
outbox, and it speaks a complete HTTP API. What it does not own is the model:
OpenWork is "powered by OpenCode" and delegates every turn to an OpenCode engine
it is pointed at.

That is the decision that made this a wrap rather than a port. The rule from
[the ViMax integration](VIMAX_INTEGRATION.md) is to check what a clone's
dependencies actually call out to and whether those exist here, before looking
at its architecture. OpenWork calls out to OpenCode — and Breadboard has
OpenCode running on ChatMock already, for `/agents:opencode`. The missing
provider was one Breadboard could supply, so the clone runs as itself and
pulling it upgrades the agent.

## What runs

Two supervised processes, started lazily on the first run and reused:

```
Breadboard run route
   └── OpenWork server        bun <prepared>/apps/server/src/cli.ts
        └── OpenCode engine   bunx --bun opencode-ai@<pinned> serve
             └── ChatMock     http://127.0.0.1:8765/v1
```

A cold start is about 6 seconds and a warm one about 2, which is why the
processes are held rather than started per run.

### The server is prepared, not installed

The published `openwork-server` npm package ships **one platform's** compiled
binary and no `openwork-server.exe`, so on Windows its launcher fails with
"Unable to find an OpenWork server entrypoint". Upstream's own fallback — run
the source with Bun — is the path that works, so setup assembles a runnable
copy in `dashboard/openwork-runtime/`:

```
apps/server/src           the server itself
apps/server/package.json  dependencies, with the two workspace devDeps as file: links
packages/paths            imported at runtime for config/state locations
packages/types            imported for its types
constants.json            read by server.ts through ../../../constants.json
```

That last file is the non-obvious one: the import resolves *above*
`apps/server`, so a copy of the source alone starts and then dies with "Cannot
find module". The layout reproduces the clone's shape so every relative import
still lands where upstream expects it.

The clone is never written to — it is a pnpm workspace, and pnpm is not a
Breadboard dependency, so npm installs into the copy instead. Setup is
fingerprinted against the clone's source, so a `git pull` shows the prepared
server as stale and one button re-prepares it.

### The engine gets its own config

`opencode-config/opencode.json` belongs to `/agents:opencode`: it pins an agent
prompt about "the local Git repository connected to this Breadboard Garden" and
mounts a codebase-memory MCP server over `npx`. Pointed at an OpenWork
workspace both are wrong, and the MCP launch alone stalls the first turn while
npx fetches a package — that was the first symptom seen while building this.

So `lib/openwork/service.ts` writes its own config into
`dashboard/openwork-state/opencode.json`, declaring every model ChatMock
currently serves and one `openwork` agent. OpenCode reads its config once at
boot, so a run asking for a model the config does not declare restarts the
engine; so does a change to either stored setting.

OpenWork's own managed-engine mode (`OPENWORK_MANAGE_OPENCODE=1`) is
deliberately **not** used. It takes a single executable path, which the
`bunx --bun opencode-ai@…` fallback cannot be expressed as, and it writes its
own OpenCode config from OpenWork's runtime database — a config with no ChatMock
provider in it. Breadboard starts the engine itself and passes
`--opencode-base-url`, which keeps the model wiring in one place.

## A run

`POST /workspace/:id/sessions` takes the prompt and starts the turn, so one call
is the whole trigger — OpenWork has no separate "send a message" endpoint.

Progress comes from the **engine's** event stream, not the server's.
`/workspace/:id/events` on the OpenWork server carries configuration-reload
notices only; upstream's desktop app subscribes to OpenCode directly for the
turn, and so does the run manager. `message.updated` announces a message and its
role, `message.part.updated` carries the text, and `session.idle` ends the run.
Roles are tracked because the user's own prompt streams back as a text part too.

Deliverables are the workspace outbox (`.opencode/openwork/outbox`), diffed
against a snapshot taken before the turn — the workspace is durable and shared,
so reporting everything in it would attach last week's documents to today's
answer.

### An empty answer is a failure

The engine leaves the assistant message with no parts **and no error** when the
provider refuses the request: a ChatMock 429 looks exactly like a silent,
instant reply. The run manager therefore treats an empty answer as a failure and
names the likely cause, rather than returning a blank turn.

## Settings

Two, both of which a run actually reads (`lib/agent-settings/catalog.ts`):

| Setting | What it changes |
| --- | --- |
| Ask for files, not just an answer | Whether the prompt asks for deliverables in the outbox |
| Let it run commands | The engine agent's bash permission, and the matching sentence in the prompt |

`ask` is never used as a permission value: nobody is watching a chat run, so a
prompt would hang until the stream timed out. Everything outside the workspace
stays denied either way.

## Using it

Pick OpenWork in the capability palette or type the command:

```
/agents:openwork read the notes in the workspace and write a one-page summary as a document
```

The first run of all opens the setup panel's territory: it needs the clone, Bun,
a prepared server and an OpenCode engine. The panel reports each separately
because each has its own fix, and only one — preparing the server — is something
Breadboard can do for you.

## Where things are

| Path | What it is |
| --- | --- |
| `openwork/` | The upstream clone, and the source of truth for the server |
| `dashboard/src/lib/openwork/identity.ts` | The slash command and its grammar |
| `dashboard/src/lib/openwork/runtime.ts` | Locating the clone, Bun, the prepared server and the engine |
| `dashboard/src/lib/openwork/setup.ts` | Preparing the server out of the clone, and the fingerprint that detects a pull |
| `dashboard/src/lib/openwork/service.ts` | The two supervised processes and the generated engine config |
| `dashboard/src/lib/openwork/client.ts` | The typed client for the OpenWork server API |
| `dashboard/src/lib/openwork/prompt.ts` | The three rules a workspace skill cannot know |
| `dashboard/src/lib/openwork/run-manager.ts` | Run state, the engine event stream, and the outbox diff |
| `dashboard/src/app/api/openwork/` | Start, stream (SSE), abort, artifacts, health, setup |
| `dashboard/src/app/components/hermes/inline-openwork-run.tsx` | The run card |
| `dashboard/src/app/components/hermes/openwork-settings-dialog.tsx` | The setup panel |
| `dashboard/tests/openwork-agent.test.mjs` | Identity, traits, prompt rules and settings |
| `dashboard/openwork-runtime/` | The prepared server (generated, gitignored) |
| `dashboard/openwork-workspace/` | The durable workspace (user data, gitignored) |
| `dashboard/openwork-state/` | The server's config, tokens and the engine config (gitignored) |

## Verified live (2026-08-06)

Setup prepared server 0.18.16 out of the clone; a run on
`cliproxy/claude-sonnet-5` booted the service in 6s, wrote
`breadboard-check.txt` into the outbox, streamed its answer, and the bytes read
back through the artifact route were `ALIVE`. A second run reused the service
and finished in 12s.

The ChatGPT-backed models were 429ing that day, as they have been for other
agents; the cliproxy models are on a different subscription and were the way
through, exactly as in [the HyperFrames integration](HYPERFRAMES_INTEGRATION.md).

## What is not wired

The hosted half of OpenWork. Capabilities from an OpenWork organization —
`search_capabilities` / `execute_capability`, Google Workspace, Microsoft 365 —
come from `api.openworklabs.com` and need an account there. The seam for them
already exists: they arrive as MCP servers on the workspace, so signing the
local server into an organization would make them reachable without changing
anything here.
