# Breadboard Desktop Security

## Renderer lockdown

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webviewTag: false` on the only BrowserWindow.
- Preload exposes a narrow typed API (`window.breadboardDesktop`): startup
  state, retry-failed-service, open-logs-folder, copy-redacted-diagnostics,
  quit, versions. There is **no** generic exec IPC, **no** filesystem IPC,
  and no secret ever crosses the bridge.
- Navigation is restricted to the app's own local origins (dashboard + Quartz
  on their allocated loopback ports) plus the local `file://` startup screen.
  Everything else is cancelled; http(s)/mailto links open in the OS browser.
- `window.open` is always denied (`setWindowOpenHandler` → deny); local-origin
  targets are loaded in the main window instead, external ones go to the OS.
- `will-attach-webview` is prevented; permission requests (camera, mic,
  geolocation, notifications, …) are denied except clipboard-write and
  fullscreen.
- The startup screen ships a strict CSP via `<meta http-equiv>`:
  `default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'`.

## Local services

- Every service binds `127.0.0.1` explicitly (Next `HOSTNAME`, OpenHarness
  `--hostname`, ChatMock loopback serve, Quartz local serve). Nothing binds
  `0.0.0.0` or the LAN.
- Ports are allocated per launch: the familiar defaults (3000/8765/4096/8081)
  are used when free, otherwise OS-assigned free ports; all internal URLs
  (NEXTAUTH_URL, CHATMOCK_BASE_URL, OPENHARNESS_BASE_URL,
  NEXT_PUBLIC_QUARTZ_URL, BREADBOARD_INTERNAL_URL) are derived from the
  actual allocation, so there is no fixed-port cross-application trust.
- Packaged services receive a **controlled environment**: OS essentials plus
  exactly the variables Breadboard defines — not the user's full environment.
  The PATH handed to packaged services contains only the system directories.

## Secrets

Generated once per install into `Data/config/desktop-config.json` (written
atomically, mode 0600 where the OS honors it):

- `NEXTAUTH_SECRET` (32 random bytes, base64url)
- OpenHarness server password (24 random bytes) — replaces the dev default
  `breadboard-local-dev`
- `OPENHARNESS_TOOL_SECRET` and `OPENHARNESS_CAPABILITY_SECRET`
- `gbrainAdapterSecret` (24 random bytes) — bearer secret for the loopback GBrain
  adapter; only allocated/used when `gbrainMode !== "disabled"`, and redacted from
  logs like the others.

Secrets flow to services only through process environment at spawn time.
The log manager redacts every known secret from every captured line, and the
diagnostics IPC/clipboard payload contains a redacted summary only. Secrets
never appear on command lines (arguments are passed as arrays, never through
a shell — `shell: false` everywhere).

## Authentication

Dashboard authentication is unchanged: NextAuth credentials provider, bcrypt
hashes in SQLite, JWT sessions. `NEXTAUTH_URL` is `http://127.0.0.1:<port>`,
which NextAuth treats as a non-HTTPS host, so cookies are issued without the
`Secure` attribute and work in the Electron-embedded page. Authentication is
NOT disabled for the desktop build.

## OpenHarness

- Basic-auth protected with the per-install password; the credential lives in
  the main process and the dashboard **server** only — it is never sent to
  renderer/browser code (the dashboard proxies OpenHarness through its own
  authenticated API routes, unchanged).
- The capability model, permission prompts, audits, task-gated coding
  capabilities, and skill quarantine flow are untouched. The desktop shell
  starts OpenHarness with the same `openharness-config/` the repo uses.
- Session workspaces live under `Data/runtime/openharness` (canonicalized,
  symlink-escape-checked by the existing `workspace.ts` logic, which now also
  honors `BREADBOARD_REPO_ROOT`).

## Process hygiene

- Children are spawned `windowsHide: true`, `shell: false`, args as arrays.
- Shutdown: graceful signal, bounded wait, then `taskkill /pid <pid> /T /F`
  so Bun/Python/Node descendants (including ffmpeg/yt-dlp) cannot outlive the
  app; `uncaughtException` and `process.on("exit")` paths force-kill the tree.
- Restart-on-failure is capped (3 restarts / 10 min window with backoff) to
  prevent crash loops.

## Known limitations

- The installer is currently **unsigned** (no signing credentials in this
  repository); SmartScreen will warn. Auto-update is disabled until a signed
  release pipeline exists (see DESKTOP_RELEASE_CHECKLIST.md).
- Scriberr's optional Docker mode inherits Docker Desktop's own security
  posture; it is off by default.
