# Hermes runtime

Hermes is Breadboard's only conversational runtime. ChatMock remains the model
gateway and Codex, Ruflo, OpenCode, Agent TARS, Deep Research, and Agent Reach
remain separately launched specialist agents; none of them is a fallback chat
runtime.

## Process boundary

```text
Browser
  -> Breadboard dashboard and /api/hermes/*
       -> HermesRuntimeAdapter
            -> Hermes JSON-RPC/WebSocket service on loopback
                 -> ChatMock on loopback
```

The renderer never receives the Hermes port, gateway token, tool secret,
capability secret, workspace root, or provider credentials. Breadboard owns
users, conversations, messages, gardens, artifacts, permissions, memory,
capability decisions, approvals, audits, and durable runtime mappings. Hermes
owns only the model loop and disposable live session state.

Hermes runs with the `breadboard` toolset. Its plugin calls authenticated
`/api/hermes/tools/*` routes, where Breadboard rechecks the user, conversation,
active run, capability decision, path/command scope, and payload limits.

## Runtime configuration

| Variable | Purpose |
| --- | --- |
| `HERMES_BASE_URL` | Loopback dashboard-to-Hermes URL |
| `HERMES_DASHBOARD_SESSION_TOKEN` | Hermes gateway bearer credential |
| `BREADBOARD_HERMES_TOOL_SECRET` | Hermes plugin-to-dashboard credential |
| `HERMES_CAPABILITY_SECRET` | Capability-token signing secret |
| `HERMES_ROOT` | Breadboard-owned per-session workspace root |
| `HERMES_HOME` | Hermes's disposable config/cache home |
| `HERMES_REQUEST_TIMEOUT_MS` | Bounded JSON-RPC request timeout |
| `HERMES_SKILLS_*` | Quarantine, approved, and conditional skill stores |
| `HERMES_FIRST_PARTY_SKILLS_ROOT` | Reviewed built-in skills |

`HERMES_ROOT` and `HERMES_HOME` must be different directories. The dev launcher
uses `.runtime/hermes-workspaces` and `.runtime/hermes-stack`; Electron uses
separate directories below its per-user data root.

## Desktop lifecycle

Electron allocates a private Hermes port, generates stable per-install secrets,
writes Hermes's isolated profile, starts ChatMock, and then supervises:

```text
python -m hermes_cli.main serve --isolated --host 127.0.0.1
       --port <private-port> --no-open
```

Hermes is retried with bounded health checks and process-tree cleanup. Its
failure does not prevent non-agent features from opening; agent routes return a
sanitized unavailable response until the service recovers.

Desktop config version 2 contains only Hermes runtime secrets. Loading a version
1 config migrates the predecessor tool/capability secrets forward, removes the
old runtime selector, and persists the normalized file atomically.

## Data migration

On database startup, predecessor runtime tables are renamed transactionally to
the `hermes_*` schema, including sessions, messages, decisions, runs, skills,
audits, artifacts, and visualizer jobs. The legacy provider-session column is
renamed to `hermes_session_id`, existing runtime-kind values become `hermes`,
and all rows and foreign-key relationships are retained.

New databases accept only `runtime_kind = 'hermes'`.

## Development

From the repository root:

```sh
npm run dev
```

The launcher starts ChatMock, Hermes, optional sidecars, Quartz, and the
dashboard in dependency order. A focused runtime launch remains available as
`npm run dev:hermes`.

`npm run dev:dashboard` intentionally starts only the dashboard. Run
`npm run dev:hermes` separately when using that focused workflow. The
dashboard's reconnect route probes that explicit process but never starts a
hidden detached Hermes child; without the desktop Runtime V2 supervisor or the
explicit developer process, it reports Hermes as unavailable.

## Verification

The main checks for runtime-name changes are:

```sh
npm --prefix dashboard test
npm --prefix desktop test
npm --prefix desktop run build
node --check scripts/dev-all.mjs
```

Hermes checkout tests must be invoked through `hermes-agent/scripts/run_tests.sh`
as documented by that repository.
