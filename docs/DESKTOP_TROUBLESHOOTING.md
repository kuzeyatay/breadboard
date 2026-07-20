# Breadboard Desktop Troubleshooting

## Where things are

- **Logs**: `%APPDATA%/breadboard-desktop/Data/logs/` — one bounded file per
  service (`chatmock.log`, `openharness.log`, `quartz.log`, `dashboard.log`,
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
- **Agent runtime (OpenHarness)**: see `openharness.log`. The app refuses to
  silently fall back when the mode is `required` (Breadboard's contract).
  The mode can be changed in `Data/config/desktop-config.json`
  (`openharnessMode`: `required` | `preferred` | `legacy`) while the app is
  closed.
- **Garden site (Quartz)**: the first build of a large garden can take
  minutes; the health check waits up to 5. If it fails, `quartz.log` has the
  build error (usually a malformed markdown file; remove/fix it and Retry).
- **Breadboard workspace (dashboard)**: `dashboard.log`; a corrupted
  database shows here — restore from `Data/backups/` if migration created
  one.

## Video transcription says "Scriberr unavailable"

That capability is optional and off by default. Enable it in
`Data/config/desktop-config.json` (`scriberrEnabled: true`) with either
Docker Desktop running (compatibility mode) or `scriberrBaseUrl` pointing at
an existing Scriberr instance. The rest of Breadboard works without it.

## Ports

Everything runs on `127.0.0.1` with per-launch ports (3000/8765/4096/8081
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
