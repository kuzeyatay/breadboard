# Breadboard Desktop Runtime Audit

Audited from the repository code (not from `start.bat` alone) on 2026-07-19.
This document is the factual basis for the Electron desktop conversion in
`desktop/`.

## Process inventory

Development today starts (via `start.bat` or `node scripts/dev-all.mjs`):

| Service | Required | Dev command | Port(s) | Health signal |
| --- | --- | --- | --- | --- |
| ChatMock | **yes** (generation + OpenHarness model provider) | `python chatmock.py serve --port 8765 --reasoning-effort low --reasoning-summary detailed --reasoning-compat legacy` (cwd `chatmock/`) | 8765 | `GET /health` → 200 |
| OpenHarness | **yes** in `required` mode (default); app degrades per `OPENHARNESS_MODE` | `bun run packages/opencode/src/index.ts serve --port 4096 --hostname 127.0.0.1` (cwd `openharness/`) | 4096 | `GET /global/health` with Basic auth → 200; `/config/providers` must include `chatmock` |
| Quartz | **yes** (garden rendering surface, embedded in dashboard UI) | `node quartz/bootstrap-cli.mjs build --serve --port 8081 --wsPort 3001` (cwd `quartz/`) | 8081 (site), 3001 (hot-reload ws, dev only) | HTTP 200 on `/` once first build completes |
| Dashboard | **yes** | `npm run dev` (Next.js 16, cwd `dashboard/`) | 3000 | No health route existed — `/api/health` added for the desktop supervisor |
| Scriberr | optional (video transcription) | `docker compose up` with a generated port-override file (`scripts/start-scriberr.mjs`) | 8091 (remapped from container 8080) | `GET /health` |
| Reader (Jina) | optional, **not autostarted** by any repo script | manual (`reader/`, Docker or node) | 8080 by convention | n/a — `url-to-markdown.ts` treats it as optional with explicit `READER_ALLOW_REMOTE_FALLBACK` to `https://r.jina.ai` |
| gbrain | **not a service** | n/a | n/a | It is an MCP tool checkout. OpenHarness connects to it via MCP; `dashboard/src/lib/openharness/gbrain-status.ts` only probes checkout/config/tool state. Path override: `GBRAIN_PATH`. |

Other repo directories that are *not* runtime services: `markdown-to-pdf-action`
(GitHub Action), `pdf.js` (vendored viewer assets), `shared/` (static JSON),
`openharness-skills/` (skill store content), `scripts/` (launchers + one-off
maintenance).

## Startup dependency graph (from `scripts/dev-all.mjs`)

```
ChatMock  ──────────────► OpenHarness ─┐
   │                                   ├─► Dashboard ─► window
   └───────────► (generation pipeline) │
Quartz ────────────────────────────────┘
Scriberr (optional, never blocks)
```

- ChatMock must be healthy before OpenHarness (OpenHarness loads the
  `chatmock` provider) and before the dashboard (generation pipeline).
- Quartz is independent of ChatMock/OpenHarness; the dashboard embeds its URL
  and shells out to `quartz/bootstrap-cli.mjs build` for auto-publish
  (`dashboard/src/lib/quartz-publish.ts`).
- Scriberr never blocks startup; the dashboard reports "Scriberr unavailable".
- `OPENHARNESS_MODE`: `required` (default — dashboard refuses interactive
  fallback), `preferred` (visible audited fallback), `legacy` (direct
  ChatMock). The desktop app preserves this contract and defaults to
  `required`.

## Environment variables (authoritative list in `.env.example` files)

- Root `.env`: `OPENHARNESS_{ENABLED,MODE,BASE_URL,USERNAME,PASSWORD,PORT}`,
  `CHATMOCK_{BASE_URL,API_KEY,MODEL}`, `BREADBOARD_DASHBOARD_URL`,
  `SCRIBERR_{PORT,BASE_URL,AUTOSTART}`.
- Dashboard `.env.local`: everything above plus `NEXTAUTH_SECRET`,
  `NEXTAUTH_URL`, `QUARTZ_CONTENT_PATH`, `NEXT_PUBLIC_QUARTZ_URL`,
  `OPENHARNESS_ROOT`, `OPENHARNESS_TOOL_SECRET`,
  `OPENHARNESS_CAPABILITY_SECRET`, `OPENHARNESS_SKILLS_*`, Scriberr/video
  settings (`VIDEO_TRANSCRIPTION_*`, `SCRIBERR_*`, `YTDLP_PATH`,
  `FFMPEG_PATH`, `FFPROBE_PATH`), `READER_*`.
- OpenHarness launcher exports: `OPENCODE_SERVER_PASSWORD`,
  `OPENCODE_SERVER_USERNAME`, `OPENCODE_CONFIG_DIR`
  (→ `openharness-config/`), `BREADBOARD_INTERNAL_URL`,
  `OPENHARNESS_TOOL_SECRET`, `CHATMOCK_*`, `OPENCODE_ENABLE_EXA`,
  `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`.

## Mutable data written at runtime

| Data | Dev location | Notes |
| --- | --- | --- |
| SQLite main DB | `dashboard/db/brain.db` | `src/lib/db.ts` used `process.cwd()/db` — now routed through `src/lib/runtime-paths.ts` (`BREADBOARD_DATA_DIR`) |
| Skills catalog DB | `dashboard/db/skills-catalog.db` | same treatment |
| Garden content | `quartz/content/<cluster>/{sources,learning,...}` | reached via `QUARTZ_CONTENT_PATH` (already env-driven everywhere) |
| Quartz build output | `quartz/public/` | written by every publish — the Quartz workspace itself is mutable |
| Quartz cache | `quartz/.quartz-cache/` | mutable |
| OpenHarness workspaces | `<repo>/.runtime/openharness` | override: `OPENHARNESS_ROOT` |
| Skills stores | `<repo>/.agents/skills` + conditional store | overrides: `OPENHARNESS_SKILLS_{QUARANTINE,APPROVED,CONDITIONAL}` |
| OpenCode state (sessions, auth) | OS data dir (`%LOCALAPPDATA%`/XDG) via Bun/OpenCode defaults | already outside the repo |
| ChatMock auth/cache | `%LOCALAPPDATA%/chatmock` (its own home resolution); overridable via `CHATMOCK_HOME` | login state produced by `chatmock.py login` |
| Video temp media | `VIDEO_TRANSCRIPTION_TEMP_DIR` or OS temp | job-scoped, self-cleaning |
| Dashboard uploads/artifacts | `dashboard/artifacts`, inside content tree | follows `QUARTZ_CONTENT_PATH`/data dir |

`process.cwd()` call sites audited: `db.ts`, `skills-catalog-store.ts`
(dashboard db dir); `openharness/{config,skills,system-prompts,workspace,gbrain-status}.ts`
(repo-root heuristics — all have env overrides or gained
`BREADBOARD_REPO_ROOT`); `generated-visuals.ts` (sandbox runtime script —
now also derived from `QUARTZ_CONTENT_PATH`); `api/pdfjs` route
(`node_modules` assets — valid under standalone output tracing).

## Runtime requirements per service

| Service | Runtime | Packaged strategy |
| --- | --- | --- |
| Dashboard | Node ≥ 20 (Next 16, `better-sqlite3`, `bcrypt` native) | Next **standalone** output executed with Electron's embedded Node (`ELECTRON_RUN_AS_NODE=1`); native modules rebuilt for Electron ABI and unpacked from ASAR |
| Quartz | Node (esbuild etc. in `quartz/node_modules`) | workspace copied to user-data on first run (its output + cache are mutable); executed with Electron-as-Node |
| ChatMock | Python ≥ 3.11 (flask, flask-sock, requests, websockets…) | bundled self-contained Python runtime under `resources/runtimes/python` (see DESKTOP_PACKAGING.md); dev mode falls back to system `python` |
| OpenHarness | Bun ≥ 1.3.14 (must stay a Bun app — upstream fork) | bundled `bun.exe` under `resources/runtimes/bun`; source tree + `node_modules` shipped as a resource; never rewritten to run inside Electron |
| Scriberr | Go binary + whisper models; on Windows only via Docker | **optional capability**; Docker compatibility mode only, off by default; app remains fully usable without it |
| Reader | Node/Docker | optional; remote fallback (`r.jina.ai`) already implemented in the dashboard |
| ffmpeg/ffprobe/yt-dlp | external binaries | resolved via `FFMPEG_PATH`/`FFPROBE_PATH`/`YTDLP_PATH`; bundled when present in `desktop/resources/bin`, otherwise the video capability reports itself unavailable |

## Shutdown behavior

- All dev launchers forward SIGINT/SIGTERM to children. On Windows,
  `child.kill()` alone does **not** kill grandchildren (`bun.exe` spawns
  workers; `python` may spawn ffmpeg/yt-dlp). The desktop supervisor therefore
  terminates the full process tree (`taskkill /pid <pid> /T /F`) after a
  bounded graceful window.
- Quartz's PowerShell dev wrapper auto-restarts in a loop; the desktop
  supervisor replaces this with an explicit `restartPolicy: "on-failure"`
  with backoff and a restart cap.

## Security posture found

- All services already bind 127.0.0.1 (OpenHarness enforces
  `--hostname 127.0.0.1`; ChatMock serves loopback; Quartz serve binds
  localhost; Next binds per `-H`).
- OpenHarness is Basic-auth protected; **default password
  `breadboard-local-dev`** in dev. The desktop generates a per-install random
  password instead.
- `NEXTAUTH_SECRET` default `change-me` in the example env; desktop generates
  a per-install random secret.
- Dashboard auth: NextAuth credentials provider + bcrypt + JWT sessions —
  preserved unchanged in the desktop app.

## Licensing notes for bundled components

- ChatMock: MIT (`chatmock/LICENSE`); its Python deps are BSD/MIT-family.
- OpenHarness/OpenCode fork: MIT (`openharness/LICENSE`).
- Quartz: MIT (`quartz/LICENSE.txt`).
- Bun binary redistribution: MIT-licensed runtime; permitted.
- Python embeddable distribution: PSF license; permitted with notice.
- ffmpeg builds are GPL/LGPL depending on build flavor — only bundle an
  LGPL build, or leave the path-based external resolution (current default).
- Scriberr: AGPL — a reason it stays an optional, unbundled, user-run
  service rather than embedded code.

License texts for anything actually shipped must be included by the packaging
step (`desktop/resources/licenses/`).
