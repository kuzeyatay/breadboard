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
cd hermes && bun install && cd ..
```

ChatMock is source-only Python; its dependencies are assembled into the
packaged runtime by `npm run desktop:prepare`.

## Dev mode

```
npm run desktop:dev
```

compiles the shell (`tsc`) and launches Electron with `--breadboard-dev`:

- services run from the repo exactly like `scripts/dev-all.mjs` does
  (system node/bun/python, Next dev server with Turbopack, dev data layout);
- the startup screen, supervisor, health checks, log capture and process-tree
  cleanup are the same code paths as the packaged app;
- logs: `.runtime/desktop-logs/*.log`;
- desktop config/secrets: `.runtime/desktop-config/desktop-config.json`.

The existing workflows are untouched: `start.bat`, `npm run dev`,
`npm run dev:dashboard`, etc. keep working without Electron.

For production-like dashboard speed without per-route compilation, run:

```bat
npm run desktop:dev:fast
```

This builds the standalone dashboard once and launches the same desktop
supervisor against it. Re-run the command after changing dashboard code. It
keeps using the normal development database and content paths.

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
- `BREADBOARD_DESKTOP_DASHBOARD_MODE=standalone`: uses an existing `.next-desktop` standalone build (normally set by `desktop:dev:fast`).
- `BREADBOARD_DASHBOARD_MAX_OLD_SPACE_MB`: expert override for the development
  dashboard's V8 old-space budget, in MiB. See "Development dashboard memory"
  below. Accepted range 512–16384; anything else (non-integer, out of range,
  empty) is ignored and the computed default is used.
- `BREADBOARD_MIGRATE_FROM`: explicit dev checkout to offer for first-run copy migration.
- `CHATMOCK_MODEL`: overrides the default local ChatMock model passed to services.
- `--breadboard-dev`: forces repository-backed development mode.
- `--breadboard-user-data-dir=<absolute-path>`: isolates Electron data for automated installed testing; filesystem roots and relative paths are rejected.

`NEXTAUTH_SECRET`, service ports, Hermes credentials/capability secrets,
data paths, and internal URLs are generated or resolved by the Electron main
process. They should not be hard-coded in a packaged launch.

## Development dashboard memory

`next dev` uses Next 16's default Turbopack compiler and compiles routes on
demand. The earlier Webpack audit showed why an old-space cap alone did not fix
the incident: evaluated route entries remained loaded, while native buffers,
source maps, mapped cache files, and compiler descendants consumed memory that
V8's heap counter cannot see. Repeated requests to already compiled routes were
flat; compiling new entries was the growth trigger.

Next.js guards against this itself: after every dev request it compares
`used_heap_size` with `0.8 * heap_size_limit` and restarts its server child when
it crosses. `heap_size_limit` is whatever `--max-old-space-size` says, so the
heap budget is really the *recycle* threshold, not just a ceiling.

`desktop/src/main/memory-policy.ts` computes the current heap, tree, and commit
reserves from detected physical memory and Windows commit. The V8 budget sets a
recycle/old-space boundary; the descendant-tree budget and commit governor are
the actual containment layers for memory outside that heap.

The ceiling is a trade-off in both directions. Too high and the process is
unbounded — that is the incident. Too low and Next recycles often enough to drop
in-flight interactive work: at 4 GiB a recycle landed in the middle of a QA
document ingest. Long-running work survives a recycle regardless (Learn owns
durable jobs with fenced, staleness-detected leases and a resume path), but the
request in flight does not.

An earlier policy granted 75% of physical RAM capped at 24 GiB. On a 32 GiB
machine that moved the recycle point to ~19.8 GiB of heap — more commit than the
machine had to give — and the dashboard exhausted the system commit limit
instead, taking out the Desktop Window Manager and Chromium's GPU process.

Two backstops sit behind the budget:

- The supervisor samples the dashboard's **whole process tree**, not the
  `next dev` wrapper (which stays at ~65 MB while its server child grows). A
  sustained breach of the budget in `service-definitions.ts` is logged and the
  tree is terminated; the normal restart policy and its cap take it from there.
- `npm run dev` and `npm run desktop:dev` each warn if the other is already
  running against this checkout, since two dev servers double the exposure.

Raise `BREADBOARD_DASHBOARD_MAX_OLD_SPACE_MB` only if you have measured that you
need it, and keep the total below what the machine can commit alongside
everything else.
