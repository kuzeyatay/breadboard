# Breadboard Desktop Troubleshooting

## Where things are

- **Logs**: `%APPDATA%/breadboard-desktop/Data/logs/` — one bounded file per
  service (`chatmock.log`, `hermes.log`, `postiz.log`, `quartz.log`, `dashboard.log`,
  `desktop.log`). The startup screen's "Open logs" button opens this folder.
- **User data**: `%APPDATA%/breadboard-desktop/Data/` (databases, gardens,
  config, backups). Uninstalling never deletes it.
- **Diagnostics**: the failure screen's "Copy diagnostics" puts a redacted
  JSON summary on the clipboard (versions, service states, last error).

## A required service failed to start

The startup screen names the failing service, shows the reason and the last
log lines, and offers Retry / Open logs / Copy diagnostics / Quit. Common
causes:

- **Local AI (ChatMock)**: first-run login state missing. ChatMock proxies a
  ChatGPT session; run its login once (see chatmock/README.md) — the auth
  state lives in ChatMock's own home directory and is shared with the desktop
  app. Check `chatmock.log` for the exact error.
- **Agent runtime (Hermes)**: see `hermes.log`. Breadboard keeps non-agent
  features available while agent routes report a sanitized unavailable state;
  use Retry after resolving the logged Python, provider, or port error.
- **Garden site (Quartz)**: the first build of a large garden can take
  minutes; the health check waits up to 5. If it fails, `quartz.log` has the
  build error (usually a malformed markdown file; remove/fix it and Retry).
- **Social publishing (Postiz)**: the supervised service is the lifecycle
  *coordinator*, and it becomes healthy in about a second with the Docker stack
  deliberately stopped — that is the expected state at launch, not a degraded
  one. `postiz.log` records the coordinator's state transitions and, once
  something actually asks for Postiz, Docker/Podman discovery, Compose startup,
  web readiness and API bootstrap. A first image pull can take several minutes,
  during which the Socials Manager drafts locally and syncs later; Breadboard is
  never gated on it. Install and start Docker Desktop, Docker Engine or Podman
  if activation reports the engine is unavailable.
- **Breadboard workspace (dashboard)**: `dashboard.log`; a corrupted
  database shows here — restore from `Data/backups/` if migration created
  one.

## Video transcription says "Scriberr unavailable"

That capability is optional and off by default. Enable it in
`Data/config/desktop-config.json` (`scriberrEnabled: true`) with either
Docker Desktop running (compatibility mode) or `scriberrBaseUrl` pointing at
an existing Scriberr instance. The rest of Breadboard works without it.

## Ports

Everything runs on `127.0.0.1` with per-launch ports (3000/8765/9119/8081
preferred, otherwise free ports). Another app holding a preferred port is
fine — Breadboard moves; nothing needs configuring.

## Leftover processes

Quitting the app terminates the whole service process tree (`taskkill /T`).
If a machine crash leaves orphans: `taskkill /f /im bun.exe`,
`taskkill /f /im python.exe`, and any `node.exe` whose command line mentions
`breadboard`/`server.js` — then start the app again.

## Resetting

- Fresh secrets/config: delete `Data/config/desktop-config.json` (services get
  new ports/secrets next launch; the dashboard login accounts live in the
  database, not this file).
- Fresh Quartz program files: delete `Data/quartz/.breadboard-workspace-version`
  and restart (content is preserved).
- Complete reset: close the app and delete `%APPDATA%/breadboard-desktop/Data`
  — this deletes your gardens; export first.

## `npm ci` reports `EPERM` on a native `.node` file

A running dashboard or stale standalone verification server is loading the
native module. Use `Get-CimInstance Win32_Process` to identify the exact
`node.exe` whose command line points into this checkout, stop only that stale
process, and rerun `npm ci --prefix dashboard`. Do not delete or replace the
native binary while a process has it loaded.

## Installer build runs out of disk space

Keep at least 12 GB free before the pipeline. The stage, unpacked app, NSIS
archive, installer, and temporary 64 MB NSIS chunks coexist. Release output
defaults to `%LOCALAPPDATA%/breadboard-desktop-build/release` so OneDrive does
not lock builder output. Remove only verified generated output directories or
set `BREADBOARD_DESKTOP_RELEASE_DIR` to a local disk with more free space.

## Installed smoke evidence

Pass an explicit evidence directory as the second argument when needed:

```bat
npm run desktop:smoke:installed -- "<installer.exe>" "C:\temp\breadboard-smoke"
```

The summary JSON records installer hash/size/version/signing status, install
and data paths, every app-level check, exit codes, and uninstall/restoration
results. The normal user-data directory is preserved.

Keep at least 6 GB free before starting an installed smoke run. Repeated runs
retain each isolated `user-data/Data` tree by design and can eventually make
NSIS fail or crash during extraction. Preserve `installed-smoke-summary.json`,
`app-smoke-results.json`, and `app-smoke.log`, then remove only old evidence
directories' `user-data` subdirectories if space is needed.

## GBrain (knowledge retrieval)

GBrain is on by default (`preferred`). To turn it off for an install, set
`gbrainMode` to `disabled` in
`<userData>/Data/config/desktop-config.json` and restart; an install that
already recorded `disabled` keeps it. The supervised
`gbrain` adapter runs on a loopback port with a per-install secret and stores
its PGLite/index data under `<userData>/Data/gbrain` (never in packaged
resources). It never blocks app startup; when unavailable the dashboard reports a
truthful degraded/unavailable knowledge state.

The installed smoke test (`node desktop/scripts/installed-smoke-test.mjs
<Setup.exe>`) includes a GBrain lifecycle section (adapter health, real-engine
backend, data-dir location, fixture index, retrieval-after-restart, secret-absent-
from-logs, no-orphan-process). Those checks run when GBrain is enabled and record
an explicit skip otherwise. See docs/GBRAIN_INTEGRATION.md.
