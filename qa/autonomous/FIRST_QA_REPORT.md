# Breadboard first autonomous Electron QA report

Date: 2026-08-15 (Europe/Istanbul)  
Repository revision inspected: `34e83f19d12472d7ccd3e7e672f8b993c0665b2a` (`master`)  
Host: Windows 11 Enterprise 64-bit, build 26200  
Runtime: Node 24.14.1, npm 11.12.1, Electron 33.3.1, Playwright 1.62.1, Next 16.2.3

## Outcome

Breadboard now has a reusable Playwright Electron QA layer that launches and
operates the actual desktop application, provisions a disposable data tree,
starts a bounded local-service profile, captures main/renderer/network/service
evidence, preserves failure artifacts, and exercises real user workflows.

The first completed pass found and repaired four confirmed product defects:

| Severity | Defect | Final state |
| --- | --- | --- |
| P0 | Any `file:` URL was accepted by the Electron navigation policy. | Repaired and replayed through an actual renderer-originated local-file navigation. |
| P1 | An uploaded source document opened the wrong Quartz route and rendered a 404 instead of its content. | Repaired and replayed through upload, visible document selection, and Quartz fact readback. |
| P3 | The Edit garden panel had visible but unassociated Name/Description labels and no named dialog semantics. | Repaired and replayed through semantic labels in the original rename workflow. |
| P3 | The registration username `pattern` was invalid under browser Unicode `v`-mode regular-expression rules. | Repaired; the extracted production pattern regression passes and actual Electron registration no longer emits the error. |

Definitive deterministic Electron project result: **12 passed, 1 intentionally
gated artifact test skipped, 0 failed**. Its retained Electron run roots are
bootstrap **`20260814223102-40664-e3b5f30c`**, navigation security
**`20260814223301-40664-c11d1164`**, and shared journeys
**`20260814223307-34076-691ac548`**; two runtime-root isolation tests launch no
Electron process. Definitive exploratory inventory:
**12 PASS, 26 BLOCKED, 0 FAIL** across **38** selected scenarios in run
**`20260814223752-37908-fcb40eb9`**. `BLOCKED` is not counted as success.

This is not a packaged-release certification. No verified packaged executable
or installer was supplied, model-backed and optional-agent workflows remained
unconfigured, and the broad dashboard suite still has unrelated failures.

## System implemented

The controller is external Playwright using `import { _electron as electron }
from "playwright"`. It launches Breadboard's real Electron entry point; it does
not substitute a browser pointed at a manually started dashboard.

The principal additions are:

- `qa/electron/`: launch control, worker fixtures, isolation, diagnostics,
  selectors, semantic user journeys, deterministic fixtures, critical tests,
  exploratory inventory, packaged probe, and command runner;
- `qa/autonomous/`: 48 source-grounded manifest scenarios, the L3 bounded-loop
  contract, repair protocol, and finding schema;
- explicit QA-only desktop startup options and a hybrid path mode that reuses
  repository programs while placing every enumerated critical-profile and
  exercised application store below the disposable Electron `userData` tree;
- an explicit critical service allowlist (ChatMock, Hermes, Quartz, dashboard)
  so a credential-free run does not pull Docker stacks, models, or real account
  caches;
- isolated Quartz and Next workspaces; isolated downloads, CLIProxy, Codex,
  Hermes, and Claude state; sanitized inherited environment variables; a
  fail-closed native Next/SWC preflight; and marker/realpath/PID-guarded cleanup;
- shared isolated council-ledger configuration for ChatMock and dashboard,
  disabled/redirected ComfyUI, an isolated terminal working directory, and
  configured-only optional source/state roots that fail closed instead of
  falling back to mutable repository clones;
- QA-only Hermes containment that ignores project dotenv files, suppresses
  startup recovery and shared-venv cleanup, redirects managed/files state,
  disables lazy installs and updates, constrains backups, and rejects unsafe
  import and post-setup mutation paths;
- structured capture for Electron console/process events, renderer
  console/page errors, meaningful request failures and HTTP errors, redacted
  bodies/headers/URLs, and touched-service logs;
- retained-on-failure screenshots, Playwright traces, scenario receipts, and
  diagnostics below the gitignored `.qa-results/` directory;
- deterministic QA-only native dialog planning and external-open interception;
  production dialog, IPC, sandbox, authentication, permission, and navigation
  behavior remain unchanged outside the double gate; and
- a packaged-executable Playwright probe that is opt-in and complements rather
  than replaces the existing NSIS installed smoke test.

QA mode is accepted only when all of the following hold: development mode,
`--breadboard-qa`, `BREADBOARD_QA_MODE=1`, an absolute isolated user-data path,
and the exact `critical` service profile. Broader/full profiles are rejected,
and supplying only `--breadboard-user-data-dir` is not treated as QA mode.

Convenience commands:

```text
npm run qa:electron
npm run qa:electron:critical
npm run qa:electron:explore
npm run qa:electron:packaged
npm run qa:electron:headed
npm run qa:electron:trace
npm run qa:electron:typecheck
```

## Baselines and final checks

The worktree already contained extensive unrelated changes. They were
preserved. Baselines and final results are therefore recorded independently;
the dashboard-count delta is not attributed to this QA work.

| Check | Before this QA work | Final observation |
| --- | --- | --- |
| Desktop tests | 123/123 passed | 135/135 passed |
| Dashboard tests | 4,346 passed, 101 failed, 21 skipped | 4,479 passed, 39 failed, 21 skipped (4,539 total) |
| Focused dashboard repair/isolation regressions | Not present | 26/26 passed (including all 5 confirmed-repair tests) |
| Focused Hermes isolation regressions | Not present | 38/38 passed |
| GBrain tests | 46 passed, 1 skipped | Initial baseline only; untouched by these repairs |
| UI-TARS tests | 66 passed | Initial baseline only; untouched by these repairs |
| Dashboard production build | Environment-blocked by missing optional Mem0 modules | Not claimed as repaired; the actual-Electron QA path uses the development dashboard workspace |
| Electron QA typecheck | Not present | Passed |
| Machine-readable findings | Not present | 4/4 validated against `finding.schema.json`; 28 referenced evidence/code paths exist |
| Textual evidence privacy audit | Not present | 74 scoped text files scanned; 0 high-confidence credential, sensitive JSON-value, or email candidates. Host-local user paths remain in 17 retained evidence files; binary traces/images were not scanned. |
| Critical Electron project | Not present | 12 passed, 1 intentionally gated artifact test skipped, 0 failed (retained Electron roots: bootstrap `20260814223102-40664-e3b5f30c`, security `20260814223301-40664-c11d1164`, journeys `20260814223307-34076-691ac548`; 2 isolation tests require no Electron root) |
| Exploratory Electron inventory | Not present | 12 PASS, 26 BLOCKED, 0 FAIL across 38 selected scenarios (`20260814223752-37908-fcb40eb9`) |
| Packaged Electron project without explicit executable | Not present | 1 truthful `TEST_ENVIRONMENT` skip; no build/profile/process created |
| Intentional failure-artifact self-test | Not present | Expected nonzero assertion; screenshot, trace, diagnostics, service logs, and error context all retained |

Key final evidence:

- exploratory receipt:
  `.qa-results/runs/20260814223752-37908-fcb40eb9/scenario-results-20260814223752-37908-fcb40eb9.json`;
- final critical bootstrap run:
  `.qa-results/runs/20260814223102-40664-e3b5f30c/`;
- final critical security run:
  `.qa-results/runs/20260814223301-40664-c11d1164/navigation-security/`;
- final critical journey run:
  `.qa-results/runs/20260814223307-34076-691ac548/`;
- failure-artifact self-test:
  `.qa-results/runs/20260814211345-43600-2ae8c46e/`.

These paths are intentional repository-local, gitignored evidence copies; they
are not application state or source fixtures. Large traces and screenshots are
not committed. The mutable runtime itself remains beneath the marker-owned
temporary run root.

A final text-only privacy scan found no high-confidence credential, sensitive
JSON-value, or email candidate. Retained diagnostics still contain host-local
user paths in 17 files, and binary traces/images were not scanned; those local
artifacts are therefore not cleared for external publication without a
separate redaction review. This manual check does not replace the unavailable
formal loop privacy tooling recorded as `NOT_RUN` below.

## Confirmed repairs

### P0: arbitrary local-file navigation

Expected: only exact local product files (the startup and recovery pages) may
navigate inside a privileged desktop window. An arbitrary local fixture must
not replace that window.

Actual before repair: `isNavigationAllowed` returned true for every `file:`
URL. A semantic link injected into the real startup renderer navigated the
window to `qa/fixtures/firefly-brief.md`. Two renderer-originated reproductions
were retained under runs `20260814192152-14500-c7288db1` and
`20260814192204-40560-b6180750`. Earlier direct `page.goto()` probes were
discarded as invalid evidence because the debugging protocol does not exercise
Electron's `will-navigate` policy.

Root cause: `desktop/src/main/security.ts` treated the URL scheme as the trust
boundary instead of comparing the canonical product file URLs.

Repair: navigation policy construction now receives an exact local-file
allowlist. The lifecycle supplies only the product startup/recovery files.
Loopback ownership checks, external web delegation, sandboxing, context
isolation, and disabled Node integration were preserved.

Regression and replay:

- `desktop/tests/security.test.ts` verifies exact file admission and arbitrary
  local-file rejection;
- `desktop/tests/electron-integration.test.ts` declares only its synthetic
  local test pages and passes against a real Electron window;
- `qa/electron/specs/critical/navigation-security.spec.ts` activates a
  semantic local-file link and asserts that `will-navigate` is prevented; and
- the repaired scenario passed in run `20260814192400-13088-dcbd72df` and the
  definitive critical replay `20260814223301-40664-c11d1164`.

### P1: uploaded source opened the wrong Quartz route

Expected: after the real Add documents flow reports completion, clicking the
visible source opens the published `sources/<slug>` Quartz page and exposes the
fixture fact `FIREFLY-COPPER-17`.

Actual before repair: upload and ingestion completed, but the workspace built
the reader route from the bare slug. Quartz had emitted
`sources/firefly-brief.html`, so the iframe opened a root note and the expected
fact never appeared. The exact workflow failed twice in runs
`20260814194004-45452-3db6e353` and
`20260814195430-40540-bd1574ca`.

Root cause: source documents were routed like ordinary notes even though their
stored `relPath` records the `sources/` namespace.

Repair: `dashboard/src/lib/garden-document-route.ts` centralizes the route
contract. Source documents preserve `relPath`; legacy source records fall back
to `sources/<slug>`; ordinary and nested notes retain their real path. The
workspace source list, primary-source header, and PDF source-note link use the
same helper.

Regression and replay:

- `dashboard/tests/garden-document-route.test.mjs` covers current, legacy, and
  ordinary/nested records (3 tests); and
- the original upload/click/Quartz-readback journey passed in run
  `20260814200640-34736-3b1825dd`, definitive exploratory run
  `20260814223752-37908-fcb40eb9`, and definitive critical run
  `20260814223307-34076-691ac548`.

### P3: Edit garden fields were not semantically labeled

Expected: a keyboard/screen-reader/user-level locator can identify the Edit
garden dialog and fill its Name and Description fields by their visible labels.

Actual before repair: the labels were visual text without `htmlFor`/input IDs,
and the modal panel had no named dialog semantics. `getByLabel("Name")` failed
twice in runs `20260814201303-18308-ddf33e2e` and
`20260814202249-52012-306f61f4`.

Repair: the existing panel received `role="dialog"`, `aria-modal`, an
`aria-labelledby` heading, and label/control associations. No visual redesign
was made.

Regression and replay:

- `dashboard/tests/garden-edit-accessibility.test.mjs` protects the markup; and
- `garden-create-rename-return` passed through the original semantic workflow
  in definitive exploratory run `20260814223752-37908-fcb40eb9`.

### P3: invalid registration username pattern

Expected: the production HTML username constraint compiles under the browser's
Unicode `v`-mode and accepts only the intended letters, numbers, underscore,
and hyphen.

Actual before repair: `[a-zA-Z0-9_-]+` placed an unescaped hyphen in a Unicode
Sets character class. Actual Electron registration emitted
`Invalid character in character class` in runs
`20260814201303-18308-ddf33e2e` and
`20260814202249-52012-306f61f4`.

Repair: the production pattern now escapes the hyphen.

Regression and replay:

- `dashboard/tests/register-pattern.test.mjs` extracts the production value,
  compiles it with the browser-equivalent `v` flag, and checks accepted and
  rejected usernames; and
- definitive Electron onboarding passed and neither the
  `20260814223752-37908-fcb40eb9` nor `20260814223307-34076-691ac548`
  diagnostics contains the old pattern error.

## Exploratory scenario inventory

The definitive run `20260814223752-37908-fcb40eb9` selected 38 unique entries
from the 48-entry source-grounded manifest and recorded 12 PASS, 26 BLOCKED,
and 0 FAIL. The table below is reconciled with that retained receipt.
Supporting UI checks do not convert a missing required dependency into PASS.

| Scenario | Priority | Result | Evidence / blocker |
| --- | --- | --- | --- |
| `desktop-preload-least-privilege` | P0 | PASS | The documented preload bridge was callable, Node globals were absent, and every Electron window retained hardened webPreferences. |
| `desktop-startup-welcome-gate` | P1 | PASS | The welcome action appeared only with every required supervisor service healthy, then handed off to a distinct, interactable loopback dashboard window without a fatal diagnostic. |
| `desktop-required-service-readiness` | P1 | PASS | Dashboard, ChatMock, and Quartz answered meaningful loopback probes; disabled optional services did not block login. |
| `local-account-onboarding` | P1 | PASS | A QA-only invite registered one local account, credentials login reached Gardens, and the session survived refresh. |
| `qa-state-isolation` | P0 | PASS | Main-process and physical-store evidence placed mutable state below the marker-verified run root, and diagnostics contained no bootstrap secret. |
| `garden-create-rename-return` | P1 | PASS | Rename, description update, navigation away/back, and durable reopen passed. |
| `markdown-upload-ingestion` | P1 | PASS | The real Add documents flow completed and Quartz rendered the deterministic fact. |
| `pdf-upload-ingestion` | P1 | BLOCKED | `TEST_ENVIRONMENT`: no committed deterministic PDF fixture. |
| `unsupported-upload-visible-error` | P2 | BLOCKED | `TEST_ENVIRONMENT`: no committed harmless unsupported-extension fixture. |
| `upload-background-dismissal` | P2 | BLOCKED | `TEST_ENVIRONMENT`: committed fixtures finish too quickly to guarantee a background state. |
| `garden-link-ingestion` | P2 | BLOCKED | `EXTERNAL_DEPENDENCY`: no controlled Reader fixture URL or approved outbound dependency. |
| `garden-chat-document-grounding` | P1 | BLOCKED | `TEST_ENVIRONMENT`: no credential-free configured model can complete a grounded turn. |
| `garden-chat-follow-up-context` | P1 | BLOCKED | `TEST_ENVIRONMENT`: no grounded first turn exists. |
| `conversation-isolation` | P1 | BLOCKED | `TEST_ENVIRONMENT`: two meaningful model-backed conversations cannot be created. |
| `conversation-history-search-reopen` | P2 | BLOCKED | `TEST_ENVIRONMENT`: two completed Hermes sessions cannot be created. |
| `conversation-branch-independence` | P2 | BLOCKED | `TEST_ENVIRONMENT`: no completed multi-turn session exists to branch. |
| `chat-cancel-and-recover` | P1 | BLOCKED | `TEST_ENVIRONMENT`: no deterministic cancellable model run is configured. |
| `chat-empty-submission` | P3 | PASS | Empty Enter made no chat request; one valid turn made exactly one request and restored the composer. |
| `skills-catalog-search-detail` | P2 | PASS | Local Prebuilt catalog search/detail/provenance and close-back-to-chat passed. |
| `skill-install-and-invoke` | P2 | BLOCKED | `EXTERNAL_DEPENDENCY`: no reviewed immutable public QA skill was supplied. |
| `terminal-command-completion` | P1 | BLOCKED | `TEST_ENVIRONMENT`: no QA workspace grant/model execution; supporting terminal UI checks passed. |
| `terminal-cancel-and-reuse` | P1 | BLOCKED | `TEST_ENVIRONMENT`: no real cancellable terminal task can start. |
| `terminal-error-recovery` | P2 | BLOCKED | `TEST_ENVIRONMENT`: no scoped workspace grant/deterministic failing task. |
| `terminal-refresh-run-state` | P1 | BLOCKED | `TEST_ENVIRONMENT`: no bounded active terminal task can be created. |
| `agent-safe-run-completion` | P2 | BLOCKED | `EXTERNAL_DEPENDENCY`: no configured harmless runtime; supporting catalog checks passed. |
| `agent-cancel-and-recover` | P2 | BLOCKED | `EXTERNAL_DEPENDENCY`: optional agent runtimes are intentionally absent. |
| `artifact-create-open-content` | P1 | BLOCKED | `TEST_ENVIRONMENT`: no model-backed artifact can be created; supporting panel checks passed. |
| `artifact-refresh-restart-persistence` | P1 | BLOCKED | `TEST_ENVIRONMENT`: there is no created artifact to persist. |
| `learn-plan-confirm-build` | P2 | BLOCKED | `TEST_ENVIRONMENT`: no credential-free provider can create Learn content. |
| `learn-cancel-and-retry` | P2 | BLOCKED | `TEST_ENVIRONMENT`: no approved generated Learn plan exists. |
| `video-transcription-unavailable-state` | P2 | PASS | Disabled/unreachable transcription was truthful, started no false job, and left the garden usable. |
| `desktop-relaunch-durable-state` | P1 | PASS | First process/ports exited; a new Electron launch reopened the same account, garden, and source. |
| `desktop-renderer-refresh-persistence` | P1 | BLOCKED | `TEST_ENVIRONMENT`: completed conversation prerequisite absent; supporting garden refresh passed. |
| `desktop-required-service-recovery` | P1 | BLOCKED | `TEST_ENVIRONMENT`: no safe controlled service-termination ownership hook. |
| `windows-paths-with-spaces` | P1 | BLOCKED | `TEST_ENVIRONMENT`: this shared worker did not use a deliberately spaced run root. |
| `packaged-critical-restart-path` | P1 | BLOCKED | `TEST_ENVIRONMENT`: no verified artifact/installer and no scoped installer approval. |
| `desktop-navigation-security` | P0 | PASS | Owned loopback navigation remained usable; untrusted HTTPS delegated once and created no privileged window. |
| `desktop-clean-exit-process-tree` | P1 | BLOCKED | `TEST_ENVIRONMENT`: full child/grandchild ownership map absent; supporting main/port-release checks passed. |

## Lifecycle, isolation, and security observations

- The controller accepts only the bounded `critical` profile. Attempts to use a
  broader/full QA profile fail before service launch.
- Final QA runs left no active QA-owned process. The pre-existing developer
  Electron process remained alive with its original `electron.exe .
  --breadboard-dev` command line; it was not stopped or repurposed.
- Successful runs removed their disposable runtime. Failed or intentionally
  failed runs retained marker-guarded `%TEMP%/breadboard-qa-runtime/<run-id>`
  state for diagnosis, as designed.
- Runtime creation and cleanup validate the canonical path, ownership marker,
  and owning PID. A symlink/reparse-point runtime root is rejected fail closed;
  cleanup cannot follow it into another tree.
- ChatMock and dashboard receive the same council-ledger directory below the
  run data root, so the writer and reader cannot diverge into repository or
  user council history. The pre-existing repository `.breadboard/council-runs`
  directory was left untouched.
- Electron's `downloads` path, the active terminal working directory, Quartz,
  Next, CLIProxy, Codex, Claude, and each enumerated critical-profile state
  directory are explicit children of the disposable run root.
- ComfyUI is disabled for this profile and its environment/runtime paths are
  nevertheless redirected. Socials and Inbox integrations are explicitly
  disabled, rather than relying on missing credentials to suppress startup.
- Optional application source roots and mutable status, credential, cache, and
  workspace paths are mapped below isolated `qa-optional-sources` and
  `qa-optional-state` roots. QA-aware resolvers fail closed when a configured
  optional clone is absent or invalid; they do not silently fall back to a
  mutable checkout in the repository.
- Hermes receives an isolated home, managed directory, dashboard-files root,
  and service working directory. Its central dotenv loader ignores the project
  `.env`; early/full recovery and shared-venv quarantined-executable cleanup
  are suppressed; and lazy installs are disabled.
- Hermes CLI and web update paths are disabled in QA. Backup output must remain
  below the QA run root. Import and post-setup mutation paths are likewise
  rejected unless they satisfy the isolated QA boundary, preventing those
  specific headless endpoints and Hermes subcommands from modifying the shared
  checkout or an arbitrary host path.
- Before dashboard launch, the harness requires the existing native Next/SWC
  dependency and fails closed if it is missing. It does not run an install or
  use a package-manager fallback during QA.
- The critical restart test observes the real main PID, requires the old main
  process and published ChatMock/Quartz/dashboard ports to release, then starts
  a new Electron process with the same isolated profile.
- The packaged probe adds timestamp-guarded Windows process-tree and owning-PID
  listener evidence, loopback checks, late-child recapture, and release checks.
  Those assertions were typechecked/listed but not executed without an explicit
  packaged executable.
- Renderer windows stayed sandboxed and context-isolated with Node integration
  and webviews disabled. The preload remains an exact typed bridge rather than
  a generic filesystem, execution, or secret IPC surface.
- QA environment construction shadows credential-like inherited environment
  keys and isolates normal home/config/cache locations. Evidence redaction
  covers known secret values plus URL, header, and body material.
- Required service URLs use loopback. QA does not broaden the production
  navigation or permission policy.

One disposable QA run was disrupted during harness development when an early
cleanup smoke check guessed ownership from a recent timestamp. It partially
removed that QA run's marker/config before hitting `EBUSY`. No normal user data
or unrelated process was touched. Cleanup now requires the exact owner PID and
restores the marker if removal fails. The disrupted run is classified
`TEST_ENVIRONMENT` and is excluded from product evidence.

Several early exploratory failures were also initially classified too broadly
as `PRODUCT_BUG` by the generic exception classifier. Trace/source review
showed selector, hidden-input, and cold-navigation harness races; they were
reclassified `TEST_ENVIRONMENT`, corrected without product changes, and
replayed. Only the four reproduced defects above led to product repairs.

One garden return step also hit a single non-reproducing timeout after the
application had begun the expected route transition. It is classified
`FLAKY` harness timing, not a product defect. The harness now uses a bounded
route-commit wait for that transition, and the exact scenario was replayed; no
product file was changed for this event.

## Packaged coverage

`npm run qa:electron:packaged` requires an absolute
`BREADBOARD_QA_PACKAGED_EXE`. Without it, the project reports one explicit skip
and launches nothing. With it, the probe passes only a disposable
`--breadboard-user-data-dir`, clears the QA gate/environment, and checks the
observed executable/argv, `app.isPackaged`, exact preload surface, window
hardening, welcome-to-sign-in path, process/listener ownership, loopback-only
services, clean exit, and process/port release.

No installer or packaged executable was run in this pass. The existing
`desktop:smoke:installed` remains the release-level install/uninstall,
asset-completeness, persistence, and restoration gate. The new packaged
Playwright probe adds UI/security evidence but does not replace it.

## Autonomous-loop contract status

The repair loop is classified L3 because it may edit repository files. It is
manual-first, one scenario per invocation, capped at three iterations and 120
minutes, requires isolated mutable state and an isolated edit boundary, stops
on a repeated error or safety/human gate, and always requires a receipt and
rollback description.

The formal `agent_loop_run` and artifact tools required by the
`agent-loop-engineering` skill were unavailable. Therefore formal validation,
score, dry-run, privacy receipt, publication, activation, and scheduling remain
truthfully `NOT_RUN` in `loop-contract.yaml`. The actual Electron QA runs in
this report do not substitute for those contract-tool checks, and no unattended
loop or schedule was activated.

## Remaining risks and next actions

1. Supply reviewed deterministic PDF/unsupported/background fixtures to unblock
   the three upload negative/format paths.
2. Provide an explicitly scoped, credential-free model fixture or approved
   isolated provider profile before claiming chat context, cancellation,
   conversation, Learn, terminal execution, or artifact creation.
3. Provide reviewed immutable skill/agent fixtures before install/invoke or
   agent-run claims.
4. Add a safe dev-QA ownership/termination hook before exercising required
   service crash/recovery or claiming full dev child/grandchild orphan proof.
5. Run the opt-in packaged probe against a verified unpacked/installed artifact
   and retain the existing installed smoke as the release gate. No packaged
   artifact was available in this pass.
6. Add a deliberately spaced QA runtime launch for the Windows path scenario.
7. Keep user-authorized external repository, arbitrary filesystem, and terminal
   operations behind an explicit human boundary. The QA harness does not claim
   to contain actions a user deliberately authorizes outside its run root, and
   those paths were not exercised.
8. Exercise Manim and other globally shared Docker/container operations only in
   a separately approved disposable host/container environment; this pass did
   not attempt to isolate or run those global resources.
9. Treat native browser-profile, extension, OS keychain, and real-account
   behavior as outside this credential-free pass. Optional routes that can
   import native browser/account state remained disabled or blocked.
10. Decide how the nested `hermes-agent` repository changes are versioned and
    shipped with the parent Breadboard change. Passing tests in the nested
    checkout do not by themselves prove the parent release contains them.
11. Triage the current 39 broad dashboard-suite failures separately; they are
   outside the confirmed repairs in this pass.
12. When the formal loop tools are available, validate, score to at least 85,
   dry-run, render/read the receipt, and privacy-scan the contract before any
   automation discussion.

The report's stop reason is completion of the bounded first pass with all
confirmed repairs replayed, while preserving explicit blockers and unrelated
work rather than manufacturing additional passes.
