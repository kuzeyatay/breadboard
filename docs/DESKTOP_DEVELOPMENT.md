# Breadboard Desktop Development

## Prerequisites

The tested desktop toolchain is Windows 10/11 x64, Node ≥ 22, npm, Rust/Cargo,
Bun ≥ 1.3.14, and Python ≥ 3.11 with pip. Windows x64 is the only supported
installer target. The shell and pure unit tests are portable, but non-Windows
desktop development and packaging are not release-verified.

Install dependencies from the repository root:

```bat
npm ci --prefix dashboard
npm ci --prefix quartz
npm ci --prefix desktop
cd hermes && bun install && cd ..
```

ChatMock is source-only Python; its dependencies are assembled into the
packaged runtime by `npm run desktop:prepare`.

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
