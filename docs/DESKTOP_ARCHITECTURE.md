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
├── service-adoption   recognising an instance already running on a port
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
Postiz coordinator (Node, optional background service; idle until asked —
   it owns the Docker Compose stack but starts nothing on launch)
            ┌───────────────────────────────┐
            ▼                               │
        Dashboard (Next.js standalone, required; depends on chatmock
                   and quartz — never on postiz)
            ▼
        Main window navigates to http://127.0.0.1:<dashboard-port>
Scriberr (optional native sidecar)
```

Readiness is meaningful, not just process-alive:

- ChatMock: `GET /health` → 200
- Hermes: authenticated `GET /api/status` includes a version
- Quartz: the loopback server answers after the first site build
- Postiz: private coordinator `GET /health` → 200 as soon as the coordinator
  process is listening. It deliberately does **not** mean the Docker stack is
  running — see "Postiz is on-demand" below
- GBrain adapter (when enabled): `GET /health` → 200 (never blocks startup;
  `required: false`, so the dashboard reports a truthful degraded/unavailable
  knowledge state instead of failing the app)
- Dashboard: `GET /api/health` → `{"status":"ok"}` (verifies SQLite)

### Services that are already running are reused, not duplicated

Startup does not assume it is the first launcher on the machine. When a
service's preferred port is busy, `service-adoption.ts` asks whether the
occupant is an instance of that service *this install can use*, and the answer
decides what happens:

- **Ours.** The port is kept, nothing is spawned, and the supervisor marks the
  service healthy and adopted (the startup screen says "already running"). An
  adopted process is never restarted or killed on exit — we did not start it,
  and whoever did still depends on it.
- **Someone else's.** The service relocates to an OS-assigned port exactly as it
  always has, so an unrelated app squatting on 3000 cannot fail the launch.

"Ours" means the running instance answers *our* credentials, not merely that
something of the right kind is listening. Every service secret is persisted per
install (`runtime-config.ts`), so an instance from an earlier launch answers and
a `npm run dev` stack — which mints its own — does not. The probes therefore hit
credential-gated routes wherever one exists: Hermes's `/api/status` is a public
liveness probe that answers any caller, so its adoption probe is a gated `/api/`
path (401 = not ours, 404 = our token was accepted), and GBrain's is a POST
behind the adapter secret rather than its open `/health`.

Adoption is disabled entirely in QA mode: those profiles are isolated by design
and deliberately run in parallel with whatever else is on the machine.

`npm run dev` does the same thing through `scripts/service-probe.mjs`, and each
focused launcher (`npm run dev:<service>`) carries the same guard, so starting
the stack on top of itself reuses what is up instead of racing it for the port.

Postiz is deliberately not started from Next instrumentation. The desktop
supervisor owns its process, restart budget, readiness gate, and `postiz.log`.
Learning and generation workflows still talk to ChatMock directly.

### Postiz is on-demand

Starting Breadboard must not start Docker Desktop, the `docker-desktop` WSL VM,
or any Postiz Compose container. The supervised `postiz` service is a **lifecycle
coordinator**, not the stack: a small Node process that listens on loopback and
runs no Docker command at all until an authenticated server-side operation asks
for one.

```
user operation (a Socials Manager run, the channel-connection dialog,
                an explicit publish/schedule/sync, "Start Postiz")
  → authenticated dashboard route          requireUserId()
  → lib/socials-manager/activation.ts      the one activation seam
  → POST /ensure-ready  (loopback + per-launch capability token)
  → PostizCoordinator                      state machine, one attempt shared
  → Docker availability                    started only if it must be
  → docker compose up -d                   one project identity, one time
  → readiness + local-account bootstrap
  → Postiz public API
```

The distinction the coordinator exists to hold is that "do not block the startup
screen" (`startupPolicy: "background"`) and "do not start until asked" are
different requirements. The stack is the second; the coordinator process itself
is the first, because it has to be listening to receive the request.

- **Nothing passive activates it.** Startup, status polling, `GET
  /api/socials-manager/stack`, renderer hydration, health checks and reading
  local drafts all leave Docker alone. `GET /api/socials-manager/stack?probe=docker`
  opts into a read-only `docker info`, which starts nothing.
- **Concurrency.** Simultaneous callers share one activation; the second never
  issues a second `compose up`. A caller whose own budget expires gets an honest
  "still starting" and the Socials Manager drafts locally, exactly as before.
- **Idle shutdown.** A stack Breadboard started, with no active holds and no
  pending scheduled publishing, is brought down after `POSTIZ_IDLE_TIMEOUT_MS`
  (default 25 minutes). Any uncertainty — an unanswerable pending-work check, a
  stack that was already running, an operation in flight — leaves it running.
  `docker compose down`, never `down -v`; volumes and user data survive.
- **Ownership.** A stack that was already running when Breadboard found it is
  adopted, never stopped automatically. Breadboard never stops Docker Desktop
  and never runs `wsl --shutdown`, `docker system prune`, or `docker volume prune`.
- **Capability token.** `runtime-config.mintLaunchSecrets()` mints
  `postizCoordinatorToken` per launch. It reaches exactly two processes — the
  coordinator and the dashboard server — and never a renderer, `endpoints.json`,
  an API response, or a log line (it is added to the log redactor).

Contract, all loopback-bound:

| Endpoint | Auth | Meaning |
| --- | --- | --- |
| `GET /health` | none | the coordinator process is alive. Starts nothing. |
| `GET /status` | bearer | the state machine (`stopped`/`starting`/`ready`/`stopping`/`failed`). Side-effect-free. |
| `POST /ensure-ready` | bearer | the only door to starting the stack. Coalesced and bounded. |
| `POST /release` | bearer | drop a hold taken with `hold: true`. |
| `POST /stop` | bearer | `compose down` this project. Unconditional: the user asked. |
| `POST /shutdown` | bearer | app exit. Conditional: refuses for a pre-existing stack, an active hold, or pending scheduled work. |

**Dashboard-only development.** `npm run dev:dashboard` has no coordinator, so
`POSTIZ_COORDINATOR_URL`/`POSTIZ_COORDINATOR_TOKEN` are unset and
`activation.ts` falls back to driving `stack.ts` directly. The two cannot race:
the fallback is selected precisely when no coordinator was configured. In
desktop mode the coordinator is the only component that runs Compose.

## Modes

- **Dev** (`npm run desktop:dev`, or any non-packaged run): services and the
  Next dev server run from the repo with the development runtimes, but durable
  account data uses the same Electron user-data profile as the packaged app.
  Switching builds therefore does not fork gardens, chats, memories, or
  artifacts. QA launches use their own isolated Electron profile.
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

- `BREADBOARD_DATA_DIR` → `<data>/database` for SQLite. Desktop supplies the
  same `<data>` profile to ordinary development and packaged launches;
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
