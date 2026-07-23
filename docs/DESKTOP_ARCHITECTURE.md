# Breadboard Desktop Architecture

The desktop app is an Electron shell whose **main process is the authoritative
lifecycle owner** of the whole local Breadboard runtime. It does not re-implement
any Breadboard feature: the existing dashboard, Garden Chat, the AI terminal,
Quartz, the ChatMock generation pipeline, and OpenHarness all run unchanged as
supervised local services.

```
Electron main (desktop/src/main)
├── path-resolver      dev vs packaged locations; user-data layout
├── runtime-config     per-install secrets, typed config, atomic writes
├── ports              loopback-only dynamic port allocation
├── migration          one-time copy of a dev checkout's data
├── provisioning       first-run Quartz workspace in user data
├── service-definitions the 4(+1) supervised services and their env
├── service-manager    dependency-ordered supervisor (health, restart, kill-tree)
├── health-checker     http/tcp readiness probes
├── process-tree       Windows taskkill /T; POSIX process groups
├── log-manager        size-bounded, secret-redacted per-service logs
├── window-manager     startup screen -> dashboard navigation
├── security           navigation lockdown, window-open denial, permissions
└── app-lifecycle      orchestrates all of the above + IPC + exit guards
preload/preload.ts     narrow typed API (no fs, no exec, no secrets)
startup/               local startup screen (strict CSP, no chrome)
```

## Service graph

```
ChatMock (Python, required)
   └─► OpenHarness (Bun, required unless mode=legacy)
GBrain adapter (Bun, optional; only when gbrainMode != disabled, loopback + secret)
Quartz (Node, required)
   └────────┬───────────────────────────────┐
            ▼                               │
        Dashboard (Next.js standalone, required; depends on chatmock,
                   openharness*, quartz)
            ▼
        Main window navigates to http://127.0.0.1:<dashboard-port>
Scriberr (optional, Docker compatibility mode, default off)
```

Readiness is meaningful, not just process-alive:

- ChatMock: `GET /health` → 200
- OpenHarness: `GET /config/providers` (Basic auth) body contains `chatmock`
- Quartz: `GET /` → 200 after the first site build
- GBrain adapter (when enabled): `GET /health` → 200 (never blocks startup;
  `required: false`, so the dashboard reports a truthful degraded/unavailable
  knowledge state instead of failing the app)
- Dashboard: `GET /api/health` → `{"status":"ok"}` (verifies SQLite)

`OPENHARNESS_MODE` keeps its exact Breadboard semantics: `required` (default;
OpenHarness is a required service), `preferred` (optional service; dashboard
exposes the audited fallback state), `legacy` (OpenHarness is not started at
all and the dashboard runs the previous direct-ChatMock transport). Learning /
generation workflows always talk to ChatMock directly, exactly as before.

## Modes

- **Dev** (`npm run desktop:dev`, or any non-packaged run): services run from
  the repo with the system `node`/`bun`/`python`, the historical dev layout
  (`dashboard/db`, `quartz/content`), and the developer's environment. The
  Next dev server is used. `start.bat` and `npm run dev` keep working
  unchanged.
- **Packaged**: production builds only. Services run on bundled runtimes from
  `resources/` (read-only), all mutable data lives under the user-data
  directory, secrets are generated per install, and every port is
  conflict-checked loopback.

## Data layout (packaged)

`%APPDATA%/breadboard-desktop/Data/`

```
config/     desktop-config.json (secrets; 0600-style), migration-report.json
database/   brain.db, skills-catalog.db        (BREADBOARD_DATA_DIR)
quartz/     full mutable Quartz workspace; content/ is the garden data
  content/<cluster>/{sources,learning,...}     (QUARTZ_CONTENT_PATH)
agent-runtime/  provisioned OpenHarness workspace (sources + bun install
                performed on first launch from the bundled package cache)
runtime/    openharness session workspaces     (OPENHARNESS_ROOT)
skills/     quarantine/approved/conditional    (OPENHARNESS_SKILLS_*)
logs/       one bounded log per service + desktop.log
backups/    pre-overwrite migration backups
temp/
```

The Quartz *program files* (its compiled CLI + node_modules) are copied from
resources into the workspace on first run and refreshed per app version; its
`content/` is user data and is never overwritten. This preserves the exact
Quartz contract: `sources/` and `learning/` remain the visible top-level garden
folders, and Quartz's own `public/` + `.quartz-cache/` outputs stay next to the
content the way every Breadboard code path expects
(`quartz-publish.ts` derives the Quartz root from `QUARTZ_CONTENT_PATH`).

## Path resolution in the dashboard

`dashboard/src/lib/runtime-paths.ts` is the single authority:

- `BREADBOARD_DATA_DIR` → `<data>/database` for SQLite (desktop), falling back
  to the historical `<dashboard>/db` in dev;
- `BREADBOARD_REPO_ROOT` → read-only repo-layout assets
  (`openharness-config/system/*.md`, gbrain checkout detection, skills roots),
  falling back to the historical cwd heuristics in dev.

All previously scattered `process.cwd()` heuristics now route through it.

## Security model

See docs/DESKTOP_SECURITY.md. Highlights: every service binds `127.0.0.1`
only; per-install random `NEXTAUTH_SECRET`, OpenHarness password, tool secret
and capability secret; renderer runs sandboxed with `contextIsolation` and a
narrow typed preload; navigation restricted to the dashboard and Quartz
origins; external links open in the OS browser; no command or filesystem IPC.
