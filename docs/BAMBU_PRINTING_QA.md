# Bambu printing implementation and QA receipt

2026-09-07. All printer telemetry and physical adapter responses in this receipt are **simulated**. No real printer was connected and no physical print was started.

## Implemented path

Hermes capability and active run/turn → `bambu_print_prepare` authenticated tool route → one durable SQLite draft → normalized `printer-job` / `bambu-print-card` resource → existing Terminal/Garden renderer and transcript restoration → local/authorized attachment inspection → exact printer/plate/filament review → trusted UI approval snapshot → supervised authenticated daemon → separate FTPS upload/readiness/start → identified MQTT status → the same restored card.

The source was changed in the existing dirty checkout; unrelated changes were preserved. `hermes-agent` resolves to the same Git root in this checkout. No commit or deployment was made.

## Files changed for this feature

- `dashboard/src/lib/bambu/`: types, bounded archive inspection, compatibility, canonical store, approval/dispatch/recovery engine, runtime client, vault-backed setup, attachment authorization, HTTP scope checks, shared card observer, photo manifest and MCP guard.
- `dashboard/src/app/components/hermes/bambu-print-card.tsx`, its CSS module and `dashboard/src/app/components/settings-bambu.tsx`: native card, review sheet, confirmations, Connections setup and retained-job recovery.
- Existing `settings-connections.tsx`, `hermes/generative-ui-renderer.tsx`, `hermes/agent-runtime-panel.tsx`, Garden `workspace-client.tsx` and `dashboard/src/lib/generative-ui/contracts.ts`: connection entry, validated resource, scoped rendering and restoration through existing paths.
- `dashboard/src/app/api/hermes/connections/bambu/` and `dashboard/src/app/api/hermes/tools/bambu/`: owned job/setup/photo/file/thumbnail routes, trusted approval and protected internal telemetry handoff.
- `dashboard/src/lib/hermes/{tool-scopes,capability-broker,unified-tool-registry,mcp-connections}.ts`, generic MCP tool route and `hermes-agent/plugins/breadboard/__init__.py`: guarded preparation registration and alternate Bambu MCP rejection.
- `dashboard/scripts/{bambu-lan-adapter,runtime-v2-bambu-service}.mjs`, `dashboard/src/instrumentation-runtime.ts` and `dashboard/src/lib/supervisor-control.ts`: real LAN adapter and on-demand supervised monitoring.
- `native/runtime-{protocol,core,supervisor}/src/`: appended typed service endpoint, restricted environment, token distribution and updated native test fixtures. Existing service indices remain stable.
- `desktop/runtime-v2/manifests/services.json`, `desktop/scripts/{prepare-app-resources,verify-package}.mjs`: bounded service lifecycle, bundled scripts/dependencies and package proof inventory.
- `dashboard/package.json`, lockfile and `third-party/bambu-printer-mcp/`: exact MQTT/FTP/photo-codec dependencies, pinned reviewed upstream source, GPL license and modification notice.
- `dashboard/tests/bambu-printing.test.mjs`, `bambu-electron-ui.test.mjs`, `tests/helpers/bambu-*`, serial test runner entry and `tsconfig.bambu.json`: safety, real-route Electron integration and focused type checking.
- This receipt, `docs/BAMBU_PRINTING.md` and `docs/bambu-printing-qa/`: setup, limitations and inspected screenshots.

## Commands actually run

Commands below use the repository's installed dependencies, not a moving `npx` download.

| Working directory / command | Result |
| --- | --- |
| `dashboard`: `node --experimental-strip-types --test tests/bambu-printing.test.mjs` | **16 passed.** File/archive/compatibility/mapping, no pre-approval writes, forged/stale/expired/wrong-owner consent, physical locks, double dispatch, tampering, restart/cancel/uncertain start, stale/unrelated status and controls. |
| `dashboard`: `node --experimental-strip-types --test tests/bambu-electron-ui.test.mjs` | **Passed.** Actual tool-event normalizer, native renderer callsites/card, real API/vault/SQLite engine and authenticated gateway with deterministic fake printer. Authorized attachment, CSRF/owner/chat boundaries, keyboard file selection, broken-photo fallback, shared views, pause/resume, navigation/reload, completion, fresh reprint draft and stopped printer polling after completion. |
| `dashboard`: `node --max-old-space-size=6144 node_modules/typescript/bin/tsc -p tsconfig.bambu.json --noEmit` | **Passed.** Feature and transitive production TypeScript imports checked. |
| `dashboard`: targeted `node node_modules/eslint/bin/eslint.js` for Bambu library, components and API directories | **Passed, no warnings or errors.** |
| `desktop`: `npm run build` and `npm run test:build` | **Passed.** Desktop TypeScript and static assets/test compilation. |
| `native`: `cargo check -p breadboard-runtime-core -p breadboard-runtime-supervisor` | **Passed.** |
| `native`: `cargo test -p breadboard-runtime-core service_environment --lib` | **45 passed.** Exact Bambu environment/token boundaries included. |
| `native`: `cargo test -p breadboard-runtime-protocol --lib` | **33 passed, 1 unrelated baseline failure.** `checked_in_launch_manifests_match_the_typed_versioned_schema` assumes all services are mandatory, while the pre-existing ACE-Step manifest entry is optional. The new Bambu service is required and on-demand. |
| `desktop`: `node --test dist-tests/tests/service-definitions.test.js dist-tests/tests/packaging-config.test.js` | **35 passed, 1 unrelated baseline failure.** ChatMock reload test expects four watched files; existing implementation adds `subscription_voice.py` and `app.py`. |
| `desktop`: `npm run prepare:native-runtime` | Optimized native release **build passed**. Copying `breadboard-runtime.exe` into staged resources was **blocked by EBUSY** because the existing Breadboard app holds it open. It was not killed. |
| `desktop`: `npm run build:dashboard` | **Blocked by existing memory admission guard.** 17,728 MB free Windows commit could not retain the 11,321 MB reserve plus 11,264 MB build estimate. Guard preserved. |
| Full dashboard `tsc --noEmit` at default heap | **Heap exhausted at approximately 4 GiB.** The focused 6 GiB type check passed; a complete dashboard type check/build is not claimed. |
| Python AST parse of the changed Hermes Breadboard plugin; focused `git diff --check` | **Passed.** |

The exact dependency installs were `mqtt@5.15.1`, patched `basic-ftp@5.2.1` and `sharp@0.34.5` using `npm install --save-exact --ignore-scripts`. The initially reviewed FTP 5.0.5 was replaced; it is not the final dependency. npm reported 28 vulnerabilities across the existing dashboard dependency graph; no blanket dependency upgrade or audit fix was applied.

The Electron test uses ordinary Chromium compositing in non-focused test windows outside the visible desktop, with its own profile and database. Host authentication/session/run lookup and native lease allocation are fixture authorities; they do not read the user's account or runtime state. Renderer and physical job states come from the production modules. This is a software integration harness, not a complete packaged-shell launch. It cannot be enabled as a production fake-printer connection.

## Inspected screenshots

All show a simulated configured P1S, two distinct PLA colours on two AMS units and an honest unavailable-photo fallback. No product marketing photograph is redistributed. Files are native Electron captures, not image-generated UI. Light and dark themes use the actual Breadboard CSS tokens. Narrow cards occupy approximately 320 CSS pixels; full screenshots retain Windows display scaling.

- [Review, mapping and physical confirmations](bambu-printing-qa/review-light.png)
- [Upload with unknown byte progress](bambu-printing-qa/uploading-light.png)
- [Identified printing at 42%](bambu-printing-qa/printing-light.png)
- [Paused, light](bambu-printing-qa/paused-light.png)
- [Paused, dark and narrow](bambu-printing-qa/paused-dark-narrow.png)
- [Offline/stale, preserved 42%, controls disabled](bambu-printing-qa/offline-dark-narrow.png)
- [Durable completed job and fresh-draft action](bambu-printing-qa/completed-dark-narrow.png)
- [Missing mapping blocks approval](bambu-printing-qa/error-dark-narrow.png)
- [Machine-readable simulated integration receipt](bambu-printing-qa/receipt.json)

The review sheet scrolls vertically to keep full source labels and deliberate confirmations readable. Progress never seeks or advances on a timer. The screenshot checks cover labels, contrast, spacing, narrow layout and preserved values; functional assertions cover keyboard access and confirmation gates. The temporary QA profile/staged files are isolated from user data.

## Adapter versus hardware verification

The real adapter's selected-plate command encoding, explicit multi-AMS mapping, preparation-stage normalization and stale/partial identity rules are exercised without a printer. The protected dashboard-to-daemon boundary is exercised with the fake adapter. **Real FTPS/MQTT interoperability and physical execution have not been tested.**

**Hardware verification: BLOCKED — no printer configuration or separate physical-print authorization was supplied.** Firmware acceptance, developer-mode behavior, remote integrity facilities, exact selected plate and physical tray mapping, H2S behavior, pause/resume/stop, and completion must be verified on the actual printer through the implemented UI approval flow.

**Packaged launch verification remains blocked** by the dashboard build memory guard and the locked staged runtime executable. After the existing Breadboard app is closed and adequate memory is available, rerun `npm run build:dashboard`, `npm run prepare:native-runtime`, the normal packaging pipeline and `npm run verify:package` from `desktop`. The source integration and targeted software checks are complete; a successfully rebuilt/installed package is not claimed.

Temporary-file cleanup: automatic approval review rejected deletion of `dashboard/.tmp-bambu-upstream` and `.tmp-bambu-wire.mjs` with “blocked by policy” and no further reason. They remain local; they are not runtime dependencies. Test processes exited and the QA database/profile remain isolated under `.tmp-bambu-qa`.
