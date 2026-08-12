# Breadboard Desktop Packaging (Windows x64)

## Build pipeline

**Disk space**: the full pipeline needs roughly **12 GB free**: staged
resources ~2.5 GB, `win-unpacked` ~2.7 GB, the NSIS installer ~0.7 GB, plus
NSIS's temporary 64 MB-chunked output buffer and the dashboard/Quartz build
caches. `makensis` fails with `Error: can't write 67108864 bytes to output`
when the volume runs out — free space and re-run.

**OneDrive**: if the repository lives inside a OneDrive-synced folder, the
release output must not. `desktop/scripts/dist-win.mjs` therefore defaults the
output directory to `%LOCALAPPDATA%/breadboard-desktop-build/release`
(override with `BREADBOARD_DESKTOP_RELEASE_DIR`); building into the synced
folder fails with `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` because OneDrive holds
locks on freshly written files.

From the repository root (all steps also exist as `desktop:*` root scripts):

```bat
:: 0. lockfile validation / dependency install
npm ci --prefix dashboard
npm ci --prefix quartz
npm ci --prefix desktop
npm audit --prefix quartz --omit=dev

:: 1. dashboard production build (Next standalone into dashboard/.next-desktop)
npm run desktop:build:dashboard

:: 2. assemble bundled runtimes (Node, Bun, self-contained Python)
::    and stage service resources
npm run desktop:prepare

:: 3. compile the Electron shell + run its tests
npm run desktop:test

:: 4. sanity-check staged resources (fails on missing binaries / staged data)
npm run desktop:verify

:: 5. build the NSIS installer
npm run desktop:dist:win

:: 6. verify packaged resources, then install/smoke/restart/uninstall
npm run desktop:verify
npm run desktop:smoke:installed -- "%LOCALAPPDATA%\breadboard-desktop-build\release\Breadboard-Setup-0.1.0-x64.exe"
```

Output: `%LOCALAPPDATA%/breadboard-desktop-build/release/Breadboard-Setup-<version>-x64.exe`
(per-user NSIS installer; Start-menu + desktop shortcut; no admin required)
and `…/release/win-unpacked/` for direct inspection. Installs to
`%LOCALAPPDATA%/Programs/Breadboard`.

The installed smoke runner uses the real NSIS installer and installed entry
point. It launches from an evidence directory outside the checkout, passes an
isolated absolute user-data path, verifies the main window and packaged web
assets, registers/logs in, creates a garden, ingests Markdown, validates files
and database persistence across restart, checks fatal logs and child-process
cleanup, then runs the installed uninstaller. Evidence defaults to
`%LOCALAPPDATA%/breadboard-desktop-smoke/<timestamp>/`. If Breadboard was
already installed, the runner closes and removes that installation first,
preserves its normal `%APPDATA%` data, and reinstalls/relaunches Breadboard in
a `finally` path after the isolated smoke test.

Keep at least 6 GB free for the installed smoke run itself. Every evidence
directory intentionally retains its isolated `user-data/Data` after uninstall
to prove the uninstall policy. After preserving the JSON and log evidence, old
`user-data` directories may be removed manually when repeated runs consume too
much disk space.

To re-pack only the installer from an existing `win-unpacked` (useful when
disk space is tight — the staged `build-resources` tree can be deleted first
and regenerated later with `npm run desktop:prepare`):

```bat
npx electron-builder --win nsis --x64 --prepackaged "<release>\win-unpacked" -c.directories.output="<release>"
```

## Runtime packaging decisions

| Runtime | Decision | Rationale |
| --- | --- | --- |
| Node (dashboard, Quartz, Postiz coordinator) | Bundle the official `node.exe` (same version the repo is developed/tested with) under `resources/runtimes/node` | Keeps npm-prebuilt native modules (`better-sqlite3`, `bcrypt`) on the exact ABI they were installed for — no Electron-ABI rebuild, no ASAR-unpack complexity for service code. Services are plain resources, not ASAR members. |
| Python (Hermes) | Bundle CPython with the pinned Hermes package/source and launch its authenticated loopback `serve` command | Matches Hermes's native runtime and requires no first-launch package install. |
| Python (ChatMock) | CPython **embeddable distribution** matching the build machine's minor version, with ChatMock's pinned wheels installed into `Lib/site-packages` (`--only-binary=:all:`) | Deterministic; no dependency on the user's Python; controlled `sys.path` via `._pth` plus a relocation-safe `.pth` entry for the packaged ChatMock source. |
| ffmpeg / ffprobe / yt-dlp | Resolved from `desktop/resources/bin` when present and passed as absolute `FFMPEG_PATH`/`FFPROBE_PATH`/`YTDLP_PATH`; not bundled by default | These are only used by the optional video pipeline; when absent the dashboard reports the capability unavailable (existing behavior). Bundling an LGPL ffmpeg build is a drop-in later (place binaries in `desktop/resources/bin`). |
| Docker (Scriberr) | **Never required.** Optional compatibility mode, off by default | Scriberr is AGPL + has no native Windows binaries in this repo; transcription is an optional capability with an honest unavailable state. |
| Docker/Podman (Postiz) | **Required at desktop startup.** Compose assets are bundled, container images are pulled by the local engine | The desktop supervisor waits for the web app, bootstraps its local account, verifies the authenticated API, and writes all coordinator/Compose output to `postiz.log`. |

## electron-builder layout

- `app.asar` contains only the compiled desktop shell (`desktop/dist`).
- `resources/app-services/` — dashboard standalone tree, chatmock, hermes-agent,
  hermes-config, Postiz supervisor/Compose assets, quartz-template,
  scriberr compose file, shared assets.
- `resources/runtimes/` — node / bun / python.
- `resources/licenses/` — MIT/PSF notices for bundled components.
- NSIS: per-user (`perMachine: false`), `deleteAppDataOnUninstall: false`
  (uninstall never deletes user data), desktop + start-menu shortcuts.

## Native modules

`better-sqlite3` and `bcrypt` ship inside the dashboard standalone
`node_modules` and run under the bundled Node (same ABI). They are **not**
inside the ASAR. `desktop/scripts/verify-package.mjs` fails the build when
either `.node` binary is missing from staged or packaged output, and the
packaged smoke test exercises them (login + DB writes).

## Guard rails

- `prepare-app-resources.mjs` refuses to stage any `*.db` or non-example
  `.env*` file and dereferences symlinks (Windows-safe).
- `verify-package.mjs` re-checks both `build-resources/` and
  `release/win-unpacked/resources/`, including a real ChatMock import with the
  bundled Python executable.
- The dashboard build excludes data/secrets from output tracing
  (`next.config.ts` `dataTraceExcludes`); staging filters are the second line
  of defense.

## Signing and versioning

`desktop/package.json` is the package version authority and drives the
installer filename, Electron app version, and provisioned workspace refresh.
The current build is intentionally unsigned because no certificate is stored
in the checkout. Windows resource editing remains enabled so the executable
still receives the Breadboard icon and product metadata.
To sign a release, provide a trusted certificate through the selected signing
provider (`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` for certificate-based signing,
or an Azure Trusted Signing configuration), then verify
`Get-AuthenticodeSignature` reports `Valid` for both the installer and
installed executable.

## Known limitations

- Installer generation and installed automation support Windows x64 only.
- Unsigned builds trigger SmartScreen and must not be called externally production-ready.
- Scriberr, ffmpeg, ffprobe, and yt-dlp remain optional capabilities and are not bundled by default.
- The installed smoke runner temporarily replaces the current per-user installation; it preserves normal user data and restores the generated build afterward.
