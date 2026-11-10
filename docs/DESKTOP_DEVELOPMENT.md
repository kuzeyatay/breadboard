# Breadboard Desktop Development

## Prerequisites

The full desktop development stack currently expects:

- Windows 10 or 11 x64 (the only supported installer target; the shell and
  pure unit tests are portable, but non-Windows desktop development and
  packaging are not release-verified);
- Node.js `22.15+`, `23.5+`, or `24+` and npm (the installer build pins
  24.14.1);
- Python 3.11+ and [`uv`](https://docs.astral.sh/uv/);
- Rust and Cargo;
- Bun 1.3.14+;
- Git.

Docker Desktop, Docker Engine, or Podman is optional and is only needed for
features that depend on containerized services, such as social publishing.
Some media and specialist agents have their own documented prerequisites.

## Clone and install

```powershell
git clone https://github.com/kuzeyatay/breadboard.git
cd breadboard

npm ci
npm ci --prefix dashboard
npm ci --prefix quartz
npm ci --prefix desktop
npm ci --prefix hermes-agent

Push-Location hermes-agent
uv sync
Pop-Location
```

The repository contains several integrated upstream projects as ordinary
tracked files (see [VENDORED_REPOSITORIES.md](VENDORED_REPOSITORIES.md)). Some
optional capabilities also provision isolated runtimes on first use or through
a dedicated `npm run setup:*` command.

ChatMock is source-only Python; its dependencies are assembled into the
packaged runtime by `npm run desktop:prepare`.

## Configure development secrets

```powershell
Copy-Item .env.example .env
Copy-Item dashboard/.env.example dashboard/.env.local
```

At minimum, replace the placeholder `NEXTAUTH_SECRET` in
`dashboard/.env.local` with a long random value. Review both example files
before starting: they document model providers, local services, connected apps,
paths, and optional capabilities.

Never commit `.env`, `dashboard/.env.local`, OAuth tokens, provider keys, or
generated runtime credentials.

## Run modes

| Command | Purpose |
| --- | --- |
| `npm run dev` | The integrated Electron application in lean mode (see below). |
| `npm run desktop:dev:hot` | Electron plus the hot Next.js development server. |
| `npm run desktop:dev:lean` | Production-like standalone dashboard with lower long-running compiler overhead. |
| `npm run dev:dashboard` | Dashboard only; other required services must already be available. |
| `npm run dev:quartz` | Quartz Garden only. |
| `npm run dev:chatmock` | Local OpenAI-compatible model bridge only. |
| `npm run dev:hermes` | Hermes runtime only. |

Default manual-development URLs are:

- Dashboard: `http://localhost:3000`
- Quartz: `http://localhost:8081`
- ChatMock API: `http://localhost:8765/v1`
- Hermes: `http://localhost:9129`

Desktop launches use dynamically allocated loopback ports, so these defaults do
not necessarily match an Electron session.


### Explicit developer/build provisioning

`npm run setup:audio-analyzer` and `node scripts/setup-google-images.mjs` are
developer/build-time provisioning commands. Electron, Next, and the installed
Breadboard product never launch them, and they are not descendants of the
running Breadboard process tree. They may mutate only their documented checkout
or `.runtime` developer outputs. Product-visible setup remains an authenticated
Runtime V2 job using staged or data-root-owned artifacts, with no direct-process
fallback to either command.

## Normal development: lean mode

```bat
npm run dev
```

is the primary integrated-development command. It selects
`desktop:dev:lean`, builds or reuses the standalone production-like dashboard,
and launches the real Electron application with Runtime V2:

- Electron owns windows and exactly one fixed `breadboard-runtime.exe` root;
- Rust owns every Breadboard service, finite worker, and descendant process;
- the webpack/Turbopack development compiler is not left running;
- the startup screen, health projection, log capture, and process-tree cleanup
  use the same Runtime V2 contracts as the packaged app;
- logs: `.runtime/desktop-logs/*.log`;
- desktop config/secrets: `.runtime/desktop-config/desktop-config.json`.

The explicit equivalent is:

```bat
npm run desktop:dev:lean
```

If dashboard inputs changed but Windows cannot preserve the configured commit
reserve during a rebuild, lean mode reuses the last complete compatible build.
If no compatible build exists, it fails with an actionable error and does not
fall back to a hot compiler.

### Starting without internet

After the dependencies and native runtimes have been prepared once, the same
`npm run desktop:dev:lean` command works offline. Dashboard fonts (including the
Pomodoro serif) are bundled in the checkout, so a dashboard rebuild does not
need Google Fonts. Lean startup builds the native supervisor with Cargo's
locked, offline dependency cache.

A fresh checkout still needs the prerequisite installs and runtime preparation
while online. If Cargo reports a missing cached dependency, run
`npm --prefix desktop run prepare:native-runtime` while connected and retry.
Cloud models, websites, and other online features still require a connection;
they are not prerequisites for opening the local application.

## Explicit dashboard hot mode

Use the hot Next compiler only while actively editing dashboard UI or API code:

```bat
npm run desktop:dev:hot
```

Hot mode still launches the real Electron application and the same Rust
runtime. The difference is limited to the dashboard launch profile.

## Mode separation

`desktop/src/main/path-resolver.ts` derives the immutable application/runtime
roots and mutable data roots for development and packaged launches. Electron
passes those roots and the selected `lean`, `hot`, or `packaged` mode through a
bounded private bootstrap record. Runtime V2 then resolves only allowlisted
manifest entrypoints and environments; Electron and Next do not construct
service commands.

## Tests

```
npm run desktop:test
```

compiles `desktop/tests/**` and runs them with `node --test`. The suite covers
path resolution, config validation/redaction, the fixed Runtime V2 bootstrap
and control protocol, startup recovery/retry, shutdown, migration, renderer
navigation lockdown, the preload/IPC contract, and security-sensitive
BrowserWindow options. Real process ownership, worker cleanup, and product
parity are covered by the separate Runtime V2 Electron QA commands.

Dashboard checks are separate:

```bat
npm --prefix dashboard run lint
npm --prefix dashboard test
```

The production standalone build performs Next.js TypeScript validation:

```bat
npm run desktop:build:dashboard
```

## Iterating on the shell

- `desktop/src/main/**` — main process (strict TS, compiled to CommonJS).
- `desktop/src/preload/preload.ts` — the entire renderer surface; keep it
  narrow and typed.
- `desktop/src/startup/**` — the startup page (plain script, strict CSP; no
  frameworks).

After edits: `npm run build` inside `desktop/` (or rerun `npm run dev`).

## Environment and launch overrides

- `BREADBOARD_DESKTOP_RELEASE_DIR`: overrides the installer output directory.
- `BREADBOARD_DESKTOP_DASHBOARD_MODE=standalone`: selects the lean standalone dashboard profile (normally set by `desktop:dev:lean`).
- `BREADBOARD_DASHBOARD_MAX_OLD_SPACE_MB`: expert override for the development
  dashboard's V8 old-space budget, in MiB. See "Development dashboard memory"
  below. Accepted range 512–16384; anything else (non-integer, out of range,
  empty) is ignored and the computed default is used.
- `BREADBOARD_MIGRATE_FROM`: explicit dev checkout to offer for first-run copy migration.
- `CHATMOCK_MODEL`: overrides the default local ChatMock model passed to services.
- `--breadboard-dev`: forces repository-backed development mode.
- `--breadboard-user-data-dir=<absolute-path>`: isolates Electron data for automated installed testing; filesystem roots and relative paths are rejected.

`NEXTAUTH_SECRET`, service ports, credentials/capability secrets, data paths,
and private internal URLs are generated or resolved by trusted Runtime V2
authorities. They must not be hard-coded in a packaged launch or exposed to a
renderer.

## Development dashboard memory

The hot compiler can retain evaluated route graphs, source maps, native
buffers, mapped cache files, and compiler descendants that are not represented
by V8 old-space alone. That is why it is opt-in rather than the ordinary
long-running desktop runtime.

Lean mode avoids that persistent compiler. Runtime V2 additionally isolates
heavy finite operations in fresh workers so successful, failed, cancelled, and
resource-denied work returns memory through process exit. Service idle leases
and Windows Job Object ownership bound the remaining long-lived trees. Resource
caps remain emergency backstops, not the reclamation mechanism.

See `docs/MEMORY_TUNING.md` for the reserve policy and measurement commands.

## Building the Windows installer

```powershell
npm run desktop:build:dashboard
npm run desktop:prepare
npm run desktop:test
npm run desktop:verify
npm run desktop:dist:win
```

The installer is written to the configured desktop release directory. The
default development output is under:

```text
%LOCALAPPDATA%/breadboard-desktop-build/release/
```

The same steps run on a hosted Windows runner through the "Desktop checks and
installer" workflow. Before distributing a build, follow the
[desktop release checklist](DESKTOP_RELEASE_CHECKLIST.md).

## Other validation entry points

```powershell
npm run test:dashboard
npm run desktop:test
npm run test:scripts
npm run qa:runtime-v2:parity
npm run qa:electron:critical
```

Some suites build native components, launch Electron, or prepare local services.
See the desktop and Runtime V2 documentation before running packaged, burn-in,
or memory QA.

## Repository layout

```text
breadboard/
|-- dashboard/        Next.js application, APIs, persistence, and UI
|-- desktop/          Electron shell and desktop packaging
|-- native/           Rust Runtime V2 supervisor and shared protocols
|-- runtime-v2/       Runtime manifests and service contracts
|-- hermes-agent/     Conversational agent runtime
|-- hermes-config/    Breadboard agent, system, and tool configuration
|-- chatmock/         Local OpenAI-compatible provider bridge
|-- quartz/           Garden source and generated Quartz site
|-- docs/             Architecture, operations, and integration guides
|-- qa/               Electron, runtime, memory, and packaged-app QA
|-- scripts/          Setup, launch, migration, and validation helpers
`-- shared/           Cross-runtime shared assets and contracts
```

Additional top-level directories are pinned source snapshots of the upstream
projects Breadboard integrates. They are committed as ordinary monorepo files,
not Git submodules, so a normal clone contains the integration source. See the
[source snapshot manifest](VENDORED_REPOSITORIES.md) for revisions, licenses,
deliberate size exclusions, and the refresh procedure.

