# Breadboard Desktop Development

## Prerequisites

The tested desktop toolchain is Windows 10/11 x64, Node ≥ 22, npm, Bun ≥
1.3.14, and Python ≥ 3.11 with pip. Windows x64 is the only supported
installer target. The shell and pure unit tests are portable, but non-Windows
desktop development and packaging are not release-verified.

Install dependencies from the repository root:

```bat
npm ci --prefix dashboard
npm ci --prefix quartz
npm ci --prefix desktop
cd openharness && bun install && cd ..
```

ChatMock is source-only Python; its dependencies are assembled into the
packaged runtime by `npm run desktop:prepare`.

## Dev mode

```
npm run desktop:dev
```

compiles the shell (`tsc`) and launches Electron with `--breadboard-dev`:

- services run from the repo exactly like `scripts/dev-all.mjs` does
  (system node/bun/python, Next dev server with webpack, dev data layout);
- the startup screen, supervisor, health checks, log capture and process-tree
  cleanup are the same code paths as the packaged app;
- logs: `.runtime/desktop-logs/*.log`;
- desktop config/secrets: `.runtime/desktop-config/desktop-config.json`.

The existing workflows are untouched: `start.bat`, `npm run dev`,
`npm run dev:dashboard`, etc. keep working without Electron.

## Mode separation

`desktop/src/main/path-resolver.ts` is the only place that distinguishes dev
from packaged. Everything downstream (service definitions, migration,
provisioning) consumes its `ResolvedPaths`, so path logic cannot fork
elsewhere. In dev mode `runtimesDir` is empty and runtime binaries resolve
via PATH; in packaged mode every runtime is an absolute path under
`resources/` and the service environment is minimal.

## Tests

```
npm run desktop:test
```

compiles `desktop/tests/**` and runs them with `node --test`. The suite covers
path resolution, config validation/redaction, port allocation, dependency
ordering + cycles, health-check semantics and timeouts, required vs optional
failure, restart-loop protection, reverse-order shutdown, grandchild
process-tree termination, migration planning/idempotency, and renderer
navigation lockdown. It also checks the complete preload/IPC channel contract,
startup data-directory validation, security-sensitive BrowserWindow options,
and launches a real Electron process to verify the sandboxed preload bridge.
The service-manager tests spawn real child processes. On non-Windows hosts the
real-Electron integration test is explicitly skipped.

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

After edits: `npm run build` inside `desktop/` (or just re-run
`npm run desktop:dev`).

## Environment and launch overrides

- `BREADBOARD_DESKTOP_RELEASE_DIR`: overrides the installer output directory.
- `BREADBOARD_MIGRATE_FROM`: explicit dev checkout to offer for first-run copy migration.
- `CHATMOCK_MODEL`: overrides the default local ChatMock model passed to services.
- `--breadboard-dev`: forces repository-backed development mode.
- `--breadboard-user-data-dir=<absolute-path>`: isolates Electron data for automated installed testing; filesystem roots and relative paths are rejected.

`NEXTAUTH_SECRET`, service ports, OpenHarness credentials/capability secrets,
data paths, and internal URLs are generated or resolved by the Electron main
process. They should not be hard-coded in a packaged launch.
