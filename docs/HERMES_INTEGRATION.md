# Hermes integration

Hermes backs Breadboard's Terminal, Garden chat, and Quartz page assistant. The
browser-facing contract is the `/api/hermes/*` route tree; the implementation is
under `dashboard/src/lib/hermes`, and the provider adapter lives under
`dashboard/src/lib/agent-runtime`.

## Ownership and trust

Breadboard is the control plane and durable system of record. It owns:

- authenticated users, conversations, messages, memory, gardens, and artifacts;
- runtime-session mappings and event journals;
- capability decisions, filesystem grants, approvals, expiry, and revocation;
- connection credentials, skill review state, proposals, and audit records;
- validation and execution of terminal, Garden, artifact, MCP, and GBrain tools.

Hermes receives a bounded system prompt, selected model/reasoning settings, and
the first-party `breadboard` toolset. Its native memory and coding context are
disabled in the embedded profile. A lost Hermes live session can be reconstructed
from Breadboard's canonical transcript.

## Request flow

1. The dashboard authorizes the Breadboard conversation and active Garden.
2. A server-owned capability decision selects knowledge, technical-read, or
   scoped-implementation permissions.
3. `HermesRuntimeAdapter` creates/restores a Hermes session through the
   authenticated loopback gateway.
4. Hermes streams JSON-RPC events; Breadboard normalizes and journals them before
   SSE delivery to the authorized browser.
5. Tool calls return to `/api/hermes/tools/*`, where the full scope is checked
   again. A model-provided path, command, connection, or Garden id never grants
   authority.

Normalized events include assistant deltas/completion, reasoning status, tool
start/completion, permission requests, verification updates, session status,
errors, cancellation, and artifact lifecycle events.

## API inventory

The main route groups are:

```text
/api/hermes/health
/api/hermes/agents
/api/hermes/models
/api/hermes/commands
/api/hermes/capabilities
/api/hermes/mcp
/api/hermes/prompts
/api/hermes/skills
/api/hermes/artifacts
/api/hermes/sessions
/api/hermes/sessions/[sessionId]/messages|events|steer|abort
/api/hermes/permissions/[requestId]
/api/hermes/tools/agent-loop|artifacts|capabilities|garden|mcp|memory|premortem|terminal|watch
```

Quartz uses `/api/quartz-ai/*` as its public/authenticated proxy and never calls
Hermes directly.

## Workspaces and capabilities

Per-session workspaces live below `HERMES_ROOT`. Hermes itself uses a separate
`HERMES_HOME`. Real host paths are reachable only through Breadboard's canonical
filesystem grants and validated terminal broker.

Knowledge mode cannot mutate repositories or execute commands. Technical-read
mode permits bounded source inspection. Scoped implementation permits only the
approved roots, path patterns, commands, tools, skills, and duration. Completion,
cancellation, failure, or expiry revokes the decision.

## Skills

Reviewed first-party skills are checked in under `hermes-skills/prebuilt`.
Downloaded skills move through quarantine and explicit review before entering
approved or coding-conditional stores. Skill metadata cannot widen an active
capability decision.

Server-side prompt fragments live under `hermes-config/system`. They are composed
with the surface context and current capability decision by Breadboard; they are
not runtime credentials or browser assets.

## Agent loop engineering

The cloned [Agent Loop Engineering Kit](https://github.com/AlekseiUL/agent-loop-engineering-kit)
lives at `agent-loop-engineering-kit/` (pinned at `d8c814e`) and is reachable
through the reviewed `agent-loop-engineering` skill and the `agent_loop_run`
tool on Terminal and Garden Chat. The kit turns a repeated agent task into a
bounded loop contract — risk class, trigger, inputs, state, allowed tools,
forbidden actions, verification, stop conditions, human gates, receipt — and
then validates, scores and dry-runs that contract.

The kit designs and checks loops; it never executes one. `agent-loop-service.ts`
exposes only `init`, `validate`, `score`/`evaluate`, `dry-run`,
`render-receipt` and `privacy-scan`. Upstream `smoke` is unreachable because it
shells out to `bash scripts/smoke.sh` and `pytest` in the working directory.
Every positional path and every `--out` value is resolved inside the session's
own workspace, with absolute paths, drive letters, `..` and symlinked ancestors
rejected, so a model cannot point `validate` or `privacy-scan` at the user's
home directory and read the result back into chat.

Breadboard schedules nothing from this capability. The validated spec and its
activation conditions are handed to the user, who sets up any recurrence
deliberately through Breadboard's own scheduler.

Runtime: `agent-loop-engineering-kit/.venv` (Python 3.11+, PyYAML, jsonschema),
overridable with `BREADBOARD_AGENT_LOOP_ROOT` and `BREADBOARD_AGENT_LOOP_PYTHON`.

## Configuration and startup

Copy `.env.example` and `dashboard/.env.example` for standalone development.
The important variables are documented in [HERMES_RUNTIME.md](./HERMES_RUNTIME.md).
Normally `npm run dev` generates local secrets, starts Hermes after ChatMock, and
shares the exact same values with the dashboard process.

The Electron build packages the pinned `hermes-agent` checkout, `hermes-config`,
and `hermes-skills`; it does not package or provision the retired runtime clone.
