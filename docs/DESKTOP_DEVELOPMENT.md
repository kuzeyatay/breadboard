# Breadboard Desktop Development

## Prerequisites

The repository's normal dev toolchain: Node ≥ 20, Bun ≥ 1.3.14, Python ≥ 3.11
(with pip), npm dependencies installed in `dashboard/`, `quartz/`,
`openharness/` (bun install), plus `cd desktop && npm install`.

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
navigation lockdown. The service-manager tests spawn real child processes.

## Iterating on the shell

- `desktop/src/main/**` — main process (strict TS, compiled to CommonJS).
- `desktop/src/preload/preload.ts` — the entire renderer surface; keep it
  narrow and typed.
- `desktop/src/startup/**` — the startup page (plain script, strict CSP; no
  frameworks).

After edits: `npm run build` inside `desktop/` (or just re-run
`npm run desktop:dev`).
