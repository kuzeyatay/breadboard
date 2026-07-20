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
:: 0. one-time
cd desktop && npm install && cd ..

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
```

Output: `%LOCALAPPDATA%/breadboard-desktop-build/release/Breadboard-Setup-<version>-x64.exe`
(per-user NSIS installer; Start-menu + desktop shortcut; no admin required)
and `…/release/win-unpacked/` for direct inspection. Installs to
`%LOCALAPPDATA%/Programs/Breadboard`.

To re-pack only the installer from an existing `win-unpacked` (useful when
disk space is tight — the staged `build-resources` tree can be deleted first
and regenerated later with `npm run desktop:prepare`):

```bat
npx electron-builder --win nsis --x64 --prepackaged "<release>\win-unpacked" -c.directories.output="<release>"
```

## Runtime packaging decisions

| Runtime | Decision | Rationale |
| --- | --- | --- |
| Node (dashboard, Quartz) | Bundle the official `node.exe` (same version the repo is developed/tested with) under `resources/runtimes/node` | Keeps npm-prebuilt native modules (`better-sqlite3`, `bcrypt`) on the exact ABI they were installed for — no Electron-ABI rebuild, no ASAR-unpack complexity for service code. Services are plain resources, not ASAR members. |
| Bun (OpenHarness) | Bundle `bun.exe` under `resources/runtimes/bun`; OpenHarness ships as **sources + lockfile + a bundled package cache** (`resources/bun-cache`), and the desktop app runs `bun install` into user data on first launch | Bun's isolated installs use machine-absolute junctions (not shippable) and its hoisted linker is broken on Windows (bun 1.3.14 leaves packages empty), so the only reliable path is Bun's default install performed on the target machine, fed offline-first from the bundled cache. Preserves the upstream-friendly fork; no rewrite into Electron. First launch may consult the npm registry for manifest revalidation — documented in the first-run experience. |
| Python (ChatMock) | CPython **embeddable distribution** matching the build machine's minor version, with ChatMock's pinned wheels installed into `Lib/site-packages` (`--only-binary=:all:`) | Deterministic; no dependency on the user's Python; controlled `sys.path` via `._pth`. |
| ffmpeg / ffprobe / yt-dlp | Resolved from `desktop/resources/bin` when present and passed as absolute `FFMPEG_PATH`/`FFPROBE_PATH`/`YTDLP_PATH`; not bundled by default | These are only used by the optional video pipeline; when absent the dashboard reports the capability unavailable (existing behavior). Bundling an LGPL ffmpeg build is a drop-in later (place binaries in `desktop/resources/bin`). |
| Docker (Scriberr) | **Never required.** Optional compatibility mode, off by default | Scriberr is AGPL + has no native Windows binaries in this repo; transcription is an optional capability with an honest unavailable state. |

## electron-builder layout

- `app.asar` contains only the compiled desktop shell (`desktop/dist`).
- `resources/app-services/` — dashboard standalone tree, chatmock, openharness,
  openharness-config, quartz-template, scriberr compose file, shared assets.
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
  `release/win-unpacked/resources/`.
- The dashboard build excludes data/secrets from output tracing
  (`next.config.ts` `dataTraceExcludes`); staging filters are the second line
  of defense.
