# Breadboard Desktop Implementation Report — 2026-07-21

## Completion verdict

**Desktop conversion complete.** The Windows x64 NSIS installer was built from
the final audited checkout, installed through the real installer, launched
from the installed entry point, exercised outside the repository, restarted,
and uninstalled successfully. The exact final artifact passed 20/20 app checks
and 10/10 install/uninstall/restoration checks with zero failures.

This is an **unsigned internal release artifact**, not an externally
production-ready signed release. Signing is the only release-distribution
blocker; it does not invalidate the installed-product verification below.

## Status

| Area | Status | Evidence |
| --- | --- | --- |
| Repository/architecture audit | Passed | Existing Electron 33 + electron-builder 25 architecture preserved; `master` at `a052ec22f` during implementation. |
| Desktop unit + integration tests | Passed | 66 passed, 0 failed, 0 skipped; includes a real Electron sandboxed-preload launch. |
| Dashboard lint | Passed | 0 errors; 42 existing unused-code warnings. Generated `.next-desktop` output is now excluded. |
| Dashboard tests | Passed | 1,207 passed, 0 failed, 14 skipped, 1,221 total. Skips are explicit live-garden opt-in tests. |
| Dashboard production build | Passed | Next.js standalone build compiled, type-checked, and emitted the production route tree. |
| Quartz runtime tests | Passed | 98 passed, 0 failed, 0 skipped. |
| Quartz production dependency audit | Passed | `npm audit --prefix quartz --omit=dev`: 0 vulnerabilities after compatible lockfile updates. |
| Desktop production package verification | Passed | Staged and `win-unpacked` guards pass, including bundled Python/ChatMock and Node/PDF native imports. |
| Windows installer build | Passed | Assisted per-user NSIS x64 artifact generated successfully. |
| Installed smoke + restart | Passed | 20/20 checks, including auth, cluster creation, Markdown ingestion, assets, services, persistence, and process cleanup. |
| Uninstall + restoration | Passed | Silent uninstall removed the app, retained isolated data, and restored the pre-existing installation/data. |
| Documentation | Passed | Development, packaging, release, troubleshooting, smoke, audit, signing, and limitations documented. |
| Code signing | Blocked | No certificate/configuration is present; Authenticode reports `NotSigned`. See exact action below. |
| Auto-update | Not tested | Disabled by design (`publish: null`) until signed release infrastructure exists. |
| Optional Scriberr/video binaries | Not tested | Docker, ffmpeg, ffprobe, and yt-dlp are optional and not bundled in this release. |
| Full OpenHarness monorepo frozen install | Blocked | Two attempts could not download pinned `@solidjs/start` from `pkg.pr.new`; the staged server closure and installed OpenHarness service both passed. |
| Quartz repository-wide Prettier check | Failed | TypeScript and tests pass, but 1,172 pre-existing content/source files are not Prettier-clean; mass reformatting was outside this desktop task. |

## Final installer

- **Filename:** `Breadboard-Setup-0.1.0-x64.exe`
- **Type:** NSIS assisted per-user installer (`oneClick: false`, `perMachine: false`)
- **Architecture:** Windows x64
- **Version:** `0.1.0`
- **Path:** `C:\Users\20252082\AppData\Local\breadboard-desktop-build\release\Breadboard-Setup-0.1.0-x64.exe`
- **Size:** 518,413,329 bytes (494.40 MiB)
- **SHA-256:** `195b7867c5c3fa085770af39eb7fae594d0aa3d09ac2c2c371d2f353289f01d2`
- **Install path:** `C:\Users\20252082\AppData\Local\Programs\Breadboard`
- **Build command:** `npm run desktop:dist:win`
- **Signing:** `NotSigned`; electron-builder logged `cscInfo=null` and skipped signing.

Build warnings did not affect the artifact: the optional `desktop/resources/bin`
directory was absent; the icon's first candidate path missed but electron-builder
resolved `desktop/assets/icon.ico`; `@electron/rebuild` is also declared directly;
and signing was intentionally skipped. The Next standalone build emitted six NFT
dynamic-trace warnings. Staging/package guards still confirmed required files,
native imports, and exclusion of mutable databases/secrets.

## Installed evidence

Final evidence directory:

`C:\Users\20252082\AppData\Local\breadboard-desktop-smoke\verification-2026-07-21-final5`

Evidence files:

- `installed-smoke-summary.json` — artifact metadata and 10/10 installer,
  uninstall, data-policy, and restoration checks.
- `app-smoke-results.json` — 20/20 installed-application checks.
- `app-smoke.log` — reusable runner output.
- `user-data/Data/logs/` — isolated service logs retained after uninstall.

The installed test verified:

- required services healthy on loopback-only dynamic ports;
- no installed process referenced the repository checkout;
- a visible, responding Electron main window;
- dashboard HTML and a packaged Next.js static asset;
- Quartz, ChatMock, and authenticated OpenHarness liveness;
- invite registration and credentials login using native modules;
- authenticated cluster creation and Markdown ingestion;
- source-file persistence, database login persistence after restart, and no
  managed-process leftovers after either quit;
- no fatal startup errors in `desktop.log`;
- silent uninstall, retained user data, and restoration of the prior install.

## Defects found and resolved

1. The sandboxed preload could not depend on arbitrary local CommonJS imports.
   The preload is now self-contained and its IPC contract is tested in Node and
   a real Electron process.
2. CPython's embeddable `._pth` isolation prevented ChatMock imports in the
   installed app. Runtime assembly now writes a relocation-safe `.pth`, and
   package verification imports ChatMock with the bundled interpreter.
3. Next standalone tracing omitted `@napi-rs/canvas`, causing ingestion to fail
   while loading `pdf-parse`. Narrow route tracing now includes the Windows
   native canvas package, and verification imports the PDF runtime with bundled
   Node.
4. Process-cleanup checks counted their own PowerShell discovery process. The
   probe now excludes both the smoke-runner PID and PowerShell's `$PID`.
5. The authenticated installed smoke needed a stable cluster-creation API.
   `POST /api/clusters` now validates input and returns the created slug.
6. Repeated smoke evidence exhausted disk and caused one NSIS extraction crash
   (`3221225477`) at roughly 1.8 GB free. Retaining evidence is intentional;
   documentation now requires 6 GB smoke headroom and explains safe cleanup.
   The unchanged installer hash passed after old isolated data was removed.
7. Quartz's shipped lockfile contained nine production advisories (seven high,
   two moderate). Compatible dependency updates reduced the production audit to
   zero vulnerabilities; the audited installer then passed the full smoke run.

## Architecture decisions

- Electron main remains the single lifecycle owner for ChatMock, OpenHarness,
  Quartz, and the Next standalone dashboard.
- Packaged services use absolute bundled Node/Bun/Python paths and never depend
  on developer PATH entries or a development server.
- Mutable state stays under `%APPDATA%\breadboard-desktop\Data`; install
  resources remain read-only under Electron `resources`.
- Services bind `127.0.0.1`, use allocated launch ports, and receive generated
  secrets through a minimal process environment.
- Renderer isolation remains `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, and `webviewTag: false`; navigation is origin-restricted.
- Startup accepts an absolute isolated user-data override only for installed
  automation and rejects relative, root, or ambiguous paths.
- Uninstall never deletes app data; the smoke runner verifies this policy.

## Files changed

- Desktop contracts/security/testability: `desktop/src/shared/ipc-contract.ts`,
  `desktop/src/preload/preload.ts`, `desktop/src/main/app-lifecycle.ts`,
  `desktop/src/main/main.ts`, `desktop/src/main/startup-options.ts`,
  `desktop/src/main/window-manager.ts`, `desktop/src/main/window-options.ts`.
- Desktop verification: `desktop/tests/desktop-api.test.ts`,
  `desktop/tests/electron-integration.test.ts`,
  `desktop/tests/startup-options.test.ts`,
  `desktop/tests/window-options.test.ts`, `desktop/scripts/smoke-test.mjs`,
  `desktop/scripts/installed-smoke-test.mjs`,
  `desktop/scripts/verify-package.mjs`,
  `desktop/scripts/prepare-runtimes.mjs`.
- Build scripts: `desktop/package.json`, `package.json`.
- Dashboard integration: `dashboard/next.config.ts`,
  `dashboard/eslint.config.mjs`, `dashboard/src/app/actions/clusters.ts`,
  `dashboard/src/app/api/clusters/route.ts`,
  `dashboard/src/lib/garden-build/shadow.ts`.
- Shipped dependency security: `quartz/package-lock.json`.
- Documentation: `README.md`, `docs/DESKTOP_DEVELOPMENT.md`,
  `docs/DESKTOP_PACKAGING.md`, `docs/DESKTOP_RELEASE_CHECKLIST.md`,
  `docs/DESKTOP_TROUBLESHOOTING.md`, and this report.
- `dashboard/db/brain.db` was already modified in the checkout and was also used
  for the requested local account password reset. It is excluded from staged
  and packaged resources; no plaintext password is stored or shipped.

## Commands and results

```bat
npm ci --prefix dashboard
npm ci --prefix quartz
npm ci --prefix desktop
npm audit --prefix quartz --omit=dev
npm --prefix dashboard run lint
npm --prefix dashboard test
npm --prefix quartz test
npm run desktop:build:dashboard
npm run desktop:prepare
npm run desktop:test
npm run desktop:verify
npm run desktop:dist:win
npm run desktop:verify
npm run desktop:smoke:installed -- "%LOCALAPPDATA%\breadboard-desktop-build\release\Breadboard-Setup-0.1.0-x64.exe" "%LOCALAPPDATA%\breadboard-desktop-smoke\verification-2026-07-21-final5"
```

Final counts:

- Desktop: 66 passed, 0 failed, 0 skipped.
- Dashboard: 1,207 passed, 0 failed, 14 skipped.
- Quartz: 98 passed, 0 failed, 0 skipped.
- Installed app: 20 passed, 0 failed.
- Installer/uninstall/restoration: 10 passed, 0 failed.
- Quartz production audit: 0 vulnerabilities.

`npm --prefix quartz run check` completed TypeScript validation but failed its
repository-wide Prettier phase on 1,172 pre-existing files. Exact next action:
review a dedicated formatting-only change, run `npm --prefix quartz run format`,
then rerun `npm --prefix quartz run check`; do not combine that mass content
rewrite with this desktop release.

`bun install --frozen-lockfile` at the full `openharness/` root failed twice
because `https://pkg.pr.new/` could not serve the pinned `@solidjs/start`
snapshot. Exact next action: retry on a network that can reach `pkg.pr.new`.
The release path is independently passed: `desktop:prepare` successfully
installed the staged OpenHarness server closure, built its bundled cache, and
the installed OpenHarness endpoint enforced authentication.

## Signing and remaining limitations

**Signing — Blocked.** Evidence: `electron-builder.yml` sets
`signAndEditExecutable: false`; no certificate is stored in the checkout;
electron-builder reported `cscInfo=null`; Authenticode returned `NotSigned`.
Exact next action: obtain an OV/EV certificate or configure Azure Trusted
Signing, provide provider credentials (`WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD` for certificate signing), enable signing, rebuild, then
verify `Get-AuthenticodeSignature` is `Valid` for both installer and installed
executable. Do not distribute this unsigned artifact externally.

Other limitations and next actions:

- **14 live-garden tests — Not tested.** They require an explicit live fixture.
  Set `BREADBOARD_TEST_LIVE_GARDEN=1` with an isolated test garden and rerun the
  dashboard suite.
- **Optional transcription/video — Not tested.** Bundle licensed ffmpeg,
  ffprobe, and yt-dlp binaries or configure Scriberr/Docker, then run the video
  ingestion smoke matrix.
- **Real external AI generation — Not tested.** The smoke validates ChatMock
  health but deliberately uses `generateMap=false`. Authenticate ChatMock with
  a release test account and run one map-generation acceptance test.
- **Non-Windows platforms — Not tested.** Windows x64 is the only supported
  installer target. Add platform-specific runtime assembly, packaging config,
  and native CI before claiming macOS/Linux support.
- **Auto-update — Not tested.** It is intentionally disabled. Add only after
  signing and an authenticated HTTPS update feed are available.
- **CI automation — Not tested.** No desktop CI workflow exists. Add a Windows
  x64 runner for desktop tests/package verification; keep the installed NSIS
  smoke on a disposable Windows runner with sufficient disk.

No unresolved critical or high-severity defect remains in the tested Windows
x64 desktop release path. The remaining blocker is release signing, and the
remaining untested areas are optional, external-service, or unsupported-platform
capabilities documented above.

## Exact reproduction

1. Use Windows 10/11 x64 with Node 22+, npm, Bun 1.3.14+, Python 3.11+ with
   pip, and at least 12 GB free outside OneDrive for build output.
2. Run the commands in **Commands and results** in order.
3. Confirm `npm run desktop:verify` prints `[verify-package] OK` after the NSIS
   build.
4. Confirm the installer hash matches the SHA-256 in **Final installer**.
5. Inspect the three final evidence files and require zero failed checks.
6. Confirm the test install is removed, isolated `Data` remains, and any prior
   per-user Breadboard installation/data was restored.
