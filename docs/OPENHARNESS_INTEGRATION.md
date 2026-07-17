# OpenHarness integration

OpenHarness is Breadboard's **interactive AI agent runtime** — a local fork of
[OpenCode](https://github.com/anomalyco/opencode). It backs exactly three
interactive surfaces:

1. **Dashboard AI terminal** — a multipurpose, permissioned repo/agent surface.
2. **Garden chat** — grounded, single-garden Q&A with proposal-only writes.
3. **Quartz page AI** — a page-scoped assistant on the published site.

Everything else — document ingestion, source extraction/mapping, garden/topic
map/Learning Spine/section generation, council and critic loops, deterministic
repair, semantic auditing, finalization, Quartz publication, and embeddings —
stays on the existing ChatMock / OpenAI-compatible pipeline. **OpenHarness is not
the learning-content generation engine.**

---

## Architecture & trust boundaries

```
Browser UI
    │  (only ever talks to Breadboard)
    ▼
Breadboard dashboard backend  ── the application authorization boundary
    - authenticates the user
    - authorizes garden / page access
    - owns Breadboard session records + the durable transcript
    - selects the agent + server-controlled workspace
    - filters tools (per-surface allowlists + capability tokens)
    - normalizes and relays events (filtered to the authorized session)
    │
    ▼
OpenHarness server (127.0.0.1:4096, password-protected)
    - agent execution, model/provider access, tool execution
    - agent sessions, skills, permission events
```

The browser **never**: connects to OpenHarness; receives its URL, credentials,
filesystem paths, or provider keys; sees the unfiltered event stream; or gets raw
tool controls. It references sessions only by a **Breadboard runtime-session id**;
the OpenHarness session id, workspace directory, and agent are always derived
server-side from the authorized record.

## Process topology & ports

| Service      | Port | Notes                                   |
| ------------ | ---- | --------------------------------------- |
| Dashboard    | 3000 | Next.js, the only OpenHarness client    |
| Quartz       | 8081 | Static site; calls dashboard API only   |
| ChatMock     | 8765 | Existing generation backend (unchanged) |
| OpenHarness  | 4096 | Agent runtime, loopback + password      |

## Environment variables

Dashboard (`dashboard/.env.local`, see `dashboard/.env.example`):

| Variable | Purpose |
| --- | --- |
| `OPENHARNESS_ENABLED` | Master switch. Off → fallback to prior behavior. |
| `OPENHARNESS_BASE_URL` | OpenHarness server URL (default `http://127.0.0.1:4096`). |
| `OPENHARNESS_USERNAME` / `OPENHARNESS_PASSWORD` | Server basic-auth creds. |
| `OPENHARNESS_ROOT` | Workspace root (default `<repo>/.runtime/openharness`). |
| `OPENHARNESS_TERMINAL_AGENT` / `_GARDEN_AGENT` / `_QUARTZ_AGENT` / `_CAPABILITY_SCOUT_AGENT` | Agent names per surface. |
| `OPENHARNESS_REQUEST_TIMEOUT_MS` | HTTP timeout (default 120000). |
| `BREADBOARD_INTERNAL_URL` | Loopback URL garden/quartz tools call back on. |
| `OPENHARNESS_CAPABILITY_SECRET` | HMAC secret for capability tokens (falls back to `NEXTAUTH_SECRET`). |
| `QUARTZ_AI_ALLOWED_ORIGINS` | Extra CORS origins for public Quartz AI. |
| `OPENHARNESS_SKILLS_QUARANTINE` / `_APPROVED` | Skill roots. |

Root / startup (`.env.example`): `OPENHARNESS_PASSWORD`, `OPENHARNESS_USERNAME`,
`OPENHARNESS_PORT`, `BREADBOARD_DASHBOARD_URL` (embedded in Quartz builds).

## Development startup

Start everything (cross-platform):

```sh
npm run dev            # ChatMock + Quartz + OpenHarness + dashboard
```

Windows: `start.bat` opens each service in its own window (now including
OpenHarness). Focused commands:

```sh
npm run dev:openharness   # OpenHarness only (node scripts/start-openharness.mjs)
npm run dev:dashboard
npm run dev:quartz
npm run dev:chatmock
```

OpenHarness requires **Bun** (`bun@1.3.14+`). First run:

```sh
cd openharness && bun install
```

If Bun is not installed, the launcher prints guidance and exits; the rest of the
stack still starts. With `OPENHARNESS_ENABLED=false`, the dashboard runs normally
and the interactive surfaces use their prior behavior.

## Production startup

- Run OpenHarness as a supervised local service bound to `127.0.0.1:4096` with a
  strong `OPENCODE_SERVER_PASSWORD` and `OPENCODE_CONFIG_DIR` pointing at
  `openharness-config/`. Never expose it on a non-loopback interface unsecured.
- Set the dashboard's `OPENHARNESS_*` vars to match, and a distinct
  `OPENHARNESS_CAPABILITY_SECRET`.
- Build Quartz with `BREADBOARD_DASHBOARD_URL` set to the public dashboard URL.

## Session model (persistence)

Breadboard remains the durable record of user-visible conversations; OpenHarness
keeps its own runtime state but is never the sole record.

New tables/columns (all additive, backward-compatible — see `dashboard/src/lib/db.ts`):

- `openharness_runtime_sessions` — links a surface + (optional) chat session to an
  OpenHarness session: `surface`, `openharness_session_id`, `agent_name`,
  `cluster_id`, `garden_id`, `page_slug`, `workspace_key`, `runtime_metadata`,
  `last_runtime_status`.
- `openharness_messages` — durable transcript for the terminal/Quartz surfaces
  (which are not cluster-scoped). Garden chat continues to use `chat_sessions` /
  `chat_messages`.
- `openharness_proposals` — typed agent proposals (note / page_revision /
  visualization) with `status` (pending/applied/rejected).
- `openharness_skill_audit` — auditable skill quarantine/promotion/rejection log.
- Added nullable columns on `chat_messages`: `tool_calls`, `permission_decisions`,
  `runtime_error`, `runtime_status`, `proposal`.

## Event model

OpenHarness emits one instance-wide SSE stream (`{ id, type, properties }`),
filtered by workspace `directory`. The gateway narrows to one session and
normalizes each event into the shared contract (`assistant.delta`,
`assistant.completed`, `reasoning.status`, `tool.started`, `tool.completed`,
`permission.requested`, `session.status`, `error`). UIs never see raw event JSON.
See `dashboard/src/lib/openharness/events.ts`.

## Agent permissions

Defined in `openharness-config/agent/*.md` (loaded via `OPENCODE_CONFIG_DIR`):

- **breadboard-terminal** — multipurpose. Read/search/`git status`/`git diff`/
  focused tests/lint run freely; edits, package installs, broad shell, commits,
  migrations, network, and skill installs require approval; force-push and
  destructive deletes are denied.
- **breadboard-garden** — `"*": false` tools except the curated `garden_*` tools;
  `edit/bash/webfetch/websearch/task/skill` all denied. Cannot use shell, files,
  git, package installs, or dynamic skills.
- **breadboard-quartz** — same restrictions as garden, read-only by default.
- **breadboard-capability-scout** — subagent that can ONLY run the `find-skills`
  skill; no shell/file/edit; cannot delegate (`task: deny`). Garden/quartz cannot
  invoke it (they also have `task: deny`), so it is not an escalation path.

Defense in depth: agent permissions + per-surface capability tokens + process/
workspace isolation.

## Garden tools

`openharness-config/tool/garden.ts` exposes the scoped tools (file `garden.ts`,
export `X` → tool `garden_X`): `garden_search`, `garden_get_page`,
`garden_get_page_context`, `garden_get_source_excerpt`, `garden_get_source_figure`,
`garden_get_graph_neighbors`, `garden_get_learning_spine`,
`garden_get_content_inventory`, `garden_get_recent_events`,
`garden_run_proposal_validation`, `garden_create_note_proposal`,
`garden_propose_page_revision`, `garden_propose_visualization`.

Each tool reads the per-session **capability token** from the session workspace
(`.breadboard/capability.json`, never in the prompt) and calls
`POST /api/openharness/tools/garden`. The token pins the garden scope server-side,
so a model-supplied garden id cannot escape it. Write-like tools create typed
**proposals** (reviewed/applied by the user through Breadboard) — never a direct
markdown edit.

## Quartz integration

- Component: `quartz/quartz/components/BreadboardAI.tsx` + inline script +
  styles, registered in `components/index.ts` and mounted in `quartz.layout.ts`
  (`afterBody`). It self-gates (renders nothing on the index or non-garden pages).
- The browser calls only the dashboard: `POST /api/quartz-ai/chat` and
  `GET /api/quartz-ai/events` (SSE), with CORS for the Quartz origin.
- Public access requires the garden to be public AND chat-enabled
  (`chat_accessible`); it is rate-limited per IP. Private gardens require an
  authenticated owner, re-checked every request. Anonymous sessions are bound to
  their browser by an opaque client token.
- The dashboard base URL is configurable via `BREADBOARD_DASHBOARD_URL` at Quartz
  build time.

## Skill discovery & quarantine

- First-party skills live in `.agents/skills/` (repo-level, not OpenHarness-tied).
- `find-skills` is available ONLY to the terminal and capability scout.
- Lifecycle (never auto-installs, never auto-executes):
  `search` (`/api/openharness/skills/search`) → user asks → `install`
  (`/api/openharness/skills/install`) downloads into
  `openharness-skills/quarantine/<name>/` and inspects files/manifest/risks →
  user reviews → `promote` (`/api/openharness/skills/promote`) copies into the
  approved skills dir (`.agents/skills/`) → agents pick it up. Every decision is
  recorded in `openharness_skill_audit`.
- Validation: name sanitization (no traversal), SKILL.md presence + name match,
  script-file and suspicious-command detection, name-collision detection.

## API routes

```
/api/openharness/health
/api/openharness/agents
/api/openharness/models
/api/openharness/sessions                         (GET list, POST create)
/api/openharness/sessions/[sessionId]/messages    (POST)
/api/openharness/sessions/[sessionId]/events       (GET SSE)
/api/openharness/sessions/[sessionId]/abort        (POST)
/api/openharness/permissions/[requestId]           (POST)
/api/openharness/tools/garden                      (POST, capability-token auth)
/api/openharness/skills/search|install|promote
/api/gardens/[gardenId]/proposals                  (GET list)
/api/gardens/[gardenId]/proposals/[proposalId]     (POST apply/reject)
/api/quartz-ai/chat                                (POST + OPTIONS, CORS)
/api/quartz-ai/events                              (GET SSE + OPTIONS, CORS)
```

Every route authenticates through Breadboard, verifies session ownership and
garden/page access, derives the OpenHarness session id server-side, rejects
arbitrary workspace paths, enforces a request-size limit (256 KB), and returns
structured, secret-free errors.

## Troubleshooting

- **Terminal shows the legacy UI** → OpenHarness is disabled/unreachable; the
  surface falls back automatically. Check `GET /api/openharness/health`.
- **401 from OpenHarness** → `OPENHARNESS_PASSWORD` (dashboard) must match
  `OPENCODE_SERVER_PASSWORD` (server).
- **Garden tool "Capability token expired"** → tokens are short-lived (15 min);
  start a new turn to remint.
- **Quartz panel does nothing** → confirm the garden is public + chat-enabled, the
  dashboard URL is embedded (`BREADBOARD_DASHBOARD_URL`), and the origin is in
  `QUARTZ_AI_ALLOWED_ORIGINS`.
- **`bun: not found`** → install Bun and `bun install` in `openharness/`, or run
  with `OPENHARNESS_ENABLED=false`.

## Upgrade strategy (merging future OpenCode changes)

The fork is kept close to upstream. The only in-repo divergence is an
`openharness` bin alias in `packages/opencode/package.json` (see
`openharness/BREADBOARD.md`). All Breadboard-specific behavior is **external
configuration** (`openharness-config/`, `.agents/skills/`), so upstream merges
touch few fork files. To upgrade: pull upstream `dev`, reconcile the bin alias if
`package.json` conflicts, and re-run `bun install`.
