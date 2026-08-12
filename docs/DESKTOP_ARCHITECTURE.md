# Breadboard Desktop Architecture

The desktop app is an Electron shell whose **main process is the authoritative
lifecycle owner** of the whole local Breadboard runtime. It does not re-implement
any Breadboard feature: the existing dashboard, Garden Chat, the AI terminal,
Quartz, Postiz, the ChatMock generation pipeline, and Hermes all run unchanged as
supervised local services.

```
Electron main (desktop/src/main)
├── path-resolver      dev vs packaged locations; user-data layout
├── runtime-config     per-install secrets, typed config, atomic writes
├── ports              loopback-only dynamic port allocation
├── migration          one-time copy of a dev checkout's data
├── provisioning       first-run Quartz workspace in user data
├── service-definitions the supervised services, dependencies, and env
├── service-manager    dependency-ordered supervisor (health, restart, kill-tree)
├── health-checker     http/tcp readiness probes
├── process-tree       Windows taskkill /T; POSIX process groups
├── log-manager        size-bounded, secret-redacted per-service logs
├── window-manager     startup screen -> welcome gate -> dashboard navigation
├── security           navigation lockdown, window-open denial, permissions
└── app-lifecycle      orchestrates all of the above + IPC + exit guards
preload/preload.ts     narrow typed API (no fs, no exec, no secrets)
startup/               local startup screen (strict CSP, no chrome)
```

Once every required service is healthy the startup screen does not hand the
window over on its own. The leaf field stops, a greeting cycles through
languages, and the person clicks it away; only when the dissolve has finished
does the renderer send `breadboard:startup-continue` and the shell reveal the
dashboard. `WindowManager.showDashboard` waits on that signal (remembering one
that arrives early, and capping the wait at `WELCOME_GATE_MAX_WAIT_MS` so a
broken startup bundle cannot strand a healthy app).

While the welcome is up, the dashboard renders in a second, hidden window. The
click then swaps windows — the loaded one takes the startup window's bounds and
the startup window is destroyed — so the app is painted on its first visible
frame instead of starting a page load. A click that beats the load waits
`DASHBOARD_PRELOAD_GRACE_MS` and is then shown the partly-loaded window anyway
(its background is the color the dissolve ends on, so nothing flashes). If the
dashboard fails to load, the preload is discarded and the visible window
navigates to it, which surfaces the failure exactly as it did before.

## Service graph

```
ChatMock (Python, required)
   └─► Hermes (Python, supervised conversational runtime)
GBrain adapter (Bun, optional; only when gbrainMode != disabled, loopback + secret)
Quartz (Node, required)
Postiz coordinator (Node + Docker Compose, optional background service)
   └────────┬───────────────────────────────┐
            ▼                               │
        Dashboard (Next.js standalone, required; depends on chatmock,
                   postiz, quartz)
            ▼
        Main window navigates to http://127.0.0.1:<dashboard-port>
Scriberr (optional native sidecar)
```

Readiness is meaningful, not just process-alive:

- ChatMock: `GET /health` → 200
- Hermes: authenticated `GET /api/status` includes a version
- Quartz: the loopback server answers after the first site build
- Postiz: private coordinator `GET /health` → 200 only after the web app,
  local-account bootstrap, and an authenticated public-API request all pass
- GBrain adapter (when enabled): `GET /health` → 200 (never blocks startup;
  `required: false`, so the dashboard reports a truthful degraded/unavailable
  knowledge state instead of failing the app)
- Dashboard: `GET /api/health` → `{"status":"ok"}` (verifies SQLite)

Postiz is deliberately not started from Next instrumentation. The desktop
supervisor owns its process, restart budget, readiness gate, and `postiz.log`.
Learning and generation workflows still talk to ChatMock directly.

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
runtime/hermes/             Hermes config and disposable runtime state
runtime/hermes-workspaces/  Breadboard session workspaces (HERMES_ROOT)
skills/     quarantine/approved/conditional    (HERMES_SKILLS_*)
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
  (`hermes-config/system/*.md`, gbrain checkout detection, skills roots),
  falling back to the historical cwd heuristics in dev.

All previously scattered `process.cwd()` heuristics now route through it.

## Security model

See docs/DESKTOP_SECURITY.md. Highlights: every service binds `127.0.0.1`
only; per-install random `NEXTAUTH_SECRET`, Hermes gateway/tool/capability secrets
and capability secret; renderer runs sandboxed with `contextIsolation` and a
narrow typed preload; navigation restricted to the dashboard and Quartz
origins; external links open in the OS browser; no command or filesystem IPC.
