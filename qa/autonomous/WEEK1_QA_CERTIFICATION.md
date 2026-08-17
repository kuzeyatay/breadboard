# Breadboard QA Week 1 Certification

Week 1 asks one question: **can Breadboard's QA system be trusted to tell an
application failure apart from a harness, environment, external, or flaky one,
and to self-heal only the first?** Everything below is the evidence for that
question. It is not a product-quality report, and a green test was never the
goal — several of the most useful results in this document are failures.

Run id: `week1-20260817T113438Z`
Evidence root: `.qa-results/week1/week1-20260817T113438Z/`

---

## Revision / environment

| Field | Value |
| --- | --- |
| Revision | `91ed121d7709d89c872de63b84d16e55aa3be95c` |
| Branch | `master` |
| Working tree | dirty and **preserved** — 35 uncommitted entries at capture |
| OS | Windows 11 Enterprise 10.0.26200 (win32 x64) |
| Node | v24.14.1 |
| npm | 11.12.1 |
| Electron | 33.4.11 |
| Playwright / `@playwright/test` | 1.62.1 |
| TypeScript | 5.9.3 |

One environmental fact shapes several results below and is stated up front: the
repository was **edited concurrently by its developer throughout this session**.
The working tree grew from 35 to 111 uncommitted entries while Week 1 ran, from
authored feature work (a `fixed` prop added to `BackLink`, skills-catalog and
Hermes edits, and similar). None of that drift came from a QA run — QA launches
write only below a disposable run root, which the isolation tests below prove
independently. It does mean the baseline is a snapshot of a moving tree, and it
is why the experiment driver compares the main tree **within each experiment's
own blast radius** rather than byte-for-byte across the whole repository. A
whole-tree comparison here would report the developer's work as a QA violation.

---

## Baseline results

Captured before any Week 1 change. Full detail in
`.qa-results/week1/week1-20260817T113438Z/BASELINE.md`.

| Suite | Status | Total | Pass | Fail | Skip | Blocked | Duration |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `qa:electron:typecheck` | PASS | – | – | 0 | 0 | 0 | 3.2 s |
| `desktop:test` | PASS | 140 | 140 | 0 | 0 | 0 | 38.0 s |
| `test:dashboard` | **FAIL** | 4983 | 4911 | 51 | 21 | 0 | 200.5 s |
| `test:gbrain` | PASS | 47 | 46 | 0 | 1 | 0 | 49.8 s |
| `test:ui-tars` | PASS | 66 | 66 | 0 | 0 | 0 | 1.9 s |
| `qa:electron:critical` | **FAIL** | 13 | 7 | 1 | 1 | 4 | 342.8 s |
| `qa:electron:explore` | **FAIL** | 38 | 3 | 1 | 0 | 1 (+33 NOT_RUN) | 249.7 s |

`qa:electron:packaged` was **not** run. It is available — an installed
`Breadboard.exe` does exist on this host — but it is outside the Phase 1 suite
list, and launching the user's installed application was not necessary for this
certification. An earlier note in this run called it environment-blocked; that
was wrong and is corrected here and in the baseline. `qa:electron:hermes` was
not run either: it depends on a configured provider that the credential-free QA
profile deliberately lacks, and it is not part of the deterministic core path.

The exploratory run is more interesting as a classifier demonstration than as a
product verdict. Of 38 manifest scenarios: 3 passed
(`desktop-preload-least-privilege` P0, `desktop-startup-welcome-gate` P1,
`desktop-required-service-readiness` P1); `local-account-onboarding` (P1) hit a
120 s step timeout and was labelled `PRODUCT_BUG` **on a single unreproduced
observation**, which the contract does not accept as repair-eligible; and
`qa-state-isolation` (P0) was correctly labelled `TEST_ENVIRONMENT` rather than
`PRODUCT_BUG`, because its prerequisite account never existed and the run
therefore learned nothing about isolation. The remaining 33 are recorded as
`NOT_RUN` with their reason attached, never as passes. The equivalent
critical-suite onboarding scenario passed 3/3 in the burn-in, which puts this
failure in the same intermittent UI-timing family as B-1 rather than in a hard
break.

The 51 dashboard failures are **pre-existing**, on a dirty tree, and were not
investigated or repaired: that is unrelated product work and outside Week 1's
scope. They are recorded as evidence, not as new regressions.

In `qa:electron:critical`, one scenario failed and four never ran. The four
"did not run" entries are **intended Playwright behaviour**, not a defect:
`journeys.spec.ts` is `test.describe.serial`, so a failure deliberately skips
the rest of the group. I initially attributed them to the harness defects below
and was wrong — round 2 of the burn-in reproduced the same cascade *with* those
defects repaired. The harness defects were real and worth fixing, but they did
not cause this.

The failing scenario itself turned out not to be a product bug either. See
Flake / burn-in results.

---

## Harness defects found and repaired

Testing the tester found four real defects. Three were in the Week 1
infrastructure itself and are repaired; all four are listed because a
certification that only reports successes is worthless.

| Id | Defect | Impact | Status |
| --- | --- | --- | --- |
| H-1 | `tracing.stopChunk` rejected while persisting a failure trace (`file data stream has unexpected number of bytes`) | The Playwright trace — contractually required evidence — was **lost**, and the trace error replaced the real scenario failure | Repaired: `qa/electron/fixtures.ts` |
| H-2 | The same rejection left `traceChunkActive` set, so teardown stopped a chunk that no longer existed | A second, spurious `Must start tracing before stopping` error surfaced during worker teardown, on top of the real failure | Repaired: `qa/electron/fixtures.ts` |
| H-3 | The receipt secret scanner used `\b(?:secret\|token\|…)` , which cannot match camelCase | Breadboard's own config keys (`hermesCapabilitySecret`, `nextAuthSecret`) would have passed the scan into a receipt | Repaired: `qa/autonomous/lib/receipt.mjs` |
| H-4 | `locate()` returned `undefined` for an unrecognised selector kind | A malformed selector constant would resolve to nothing and a downstream truthiness check would pass | Repaired: `qa/electron/selectors.ts` |

H-1 is the one that mattered: the contract requires a Playwright trace on
failure, and the baseline run lost it. The repair does **not** swallow the
problem — a trace that cannot be written is recorded as a `trace-capture-failed`
diagnostic and surfaced as a `qa-evidence-gap` annotation, so an evidence gap is
always visible rather than silent. The proof it worked is direct: the baseline
failure produced screenshot + diagnostics and **no trace**; burn-in round 2's
failure produced screenshot + diagnostics **+ trace**, as did both injected
faults. `INJECTED-C` guards H-2 by reaching a third test after two failures in
the same worker (that file is deliberately not `describe.serial`).

**A correction I made to my own analysis.** I first reported that H-2 caused the
four "did not run" entries. It did not — that is `test.describe.serial`
semantics, and burn-in round 2 reproduced the same cascade with H-1/H-2 already
repaired. The defects were real; the impact claim was not, and it is corrected
here rather than quietly dropped.

Two further defects were found *by* the Week 1 tooling and are covered under
Assertion-integrity validation and Controlled self-heal experiments below.

---

## Harness self-test matrix

Two layers. The unit layer drives the real `DiagnosticsCollector`, real
`environment.ts`, and real fixture/port/selector code with injected faults and
asserts the harness *reports* them. The Electron layer (`npm run
qa:selftest:electron`) runs deliberately failing scenarios against the live
application and asserts the run produced evidence and exited non-zero.

Screenshots are asserted only where a renderer existed. No evidence was
fabricated to fill a column.

| Fault injected | Expected classification | Actual classification | Evidence captured | Repair gate allowed? | Result |
| --- | --- | --- | --- | --- | --- |
| **A** renderer assertion failure (live Electron) | PRODUCT_BUG | PRODUCT_BUG | screenshot ✓, diagnostics ✓, trace ✓ | production-source (would be) | PASS |
| **B** renderer uncaught exception (live Electron) | PRODUCT_BUG | PRODUCT_BUG | screenshot ✓, diagnostics ✓ (contains `QA_INJECTED_RENDERER_FAULT`), trace ✓ | production-source (would be) | PASS |
| **B'** renderer crash (`crash` event) | PRODUCT_BUG | PRODUCT_BUG, `fatal`, `assertNoFatal` throws | diagnostics ✓ | production-source | PASS |
| **C** main-process uncaught exception on stderr | PRODUCT_BUG | PRODUCT_BUG, `uncaught-exception` at `fatal` | main-process output ✓ | production-source | PASS |
| **C'** unexpected main-process exit (code 3) | PRODUCT_BUG | `main-process-exit` `fatal`, actionable | main-process output ✓ | production-source | PASS |
| **C''** *requested* shutdown (control) | not a failure | `info`, not actionable | diagnostics ✓ | n/a | PASS |
| **D** HTTP 500 from a Breadboard API | PRODUCT_BUG | actionable `error`, body retained | network + body ✓ | production-source | PASS |
| **D'** HTTP 404 (control) | not automatically a defect | recorded, `actionable: false` | network ✓ | **no** | PASS |
| **D''** malformed JSON API response | PRODUCT_BUG | `malformed-json-response` at `error` | network + body ✓ | production-source | PASS |
| **D'''** failed vs aborted request | failed actionable, abort not | matches | network ✓ | differs correctly | PASS |
| **E** required service unavailable (`EADDRINUSE` on startup) | TEST_ENVIRONMENT | TEST_ENVIRONMENT | main-process output ✓, `port-conflict` category ✓ | **no** | PASS |
| **E'** service log ingestion with severity | n/a | `error` lines surfaced as service diagnostics | service logs ✓ | n/a | PASS |
| **F** missing deterministic fixture | TEST_ENVIRONMENT | TEST_ENVIRONMENT | `QaFixtureError(missing)` ✓ | **no** | PASS |
| **G** malformed fixture (bad JSON, zero-byte) | TEST_ENVIRONMENT | TEST_ENVIRONMENT | `QaFixtureError(malformed)` ✓ | **no** | PASS |
| **H** explicit operation timeout | reported as timeout, never as success | exact timeout error with the offending port | error text ✓ | n/a | PASS |
| **I** owned-process leak (a still-held loopback port) | reported as unreleased | exact port reported; passes once released | error text ✓ | n/a | PASS |
| **J** non-isolated run root (repo root, filesystem root, traversing run id) | TEST_ENVIRONMENT | refused before any directory is created | throw ✓ | **no** | PASS |
| **J'** credential-like env inheritance | refused | throws `Refusing to inherit…` | throw ✓ | **no** | PASS |
| **K** forbidden filesystem target (fixture traversal, absolute escape) | TEST_ENVIRONMENT | refused as `forbidden QA path` | throw ✓ | **no** | PASS |
| **L** cleanup failure (missing marker, mismatched marker, runtime-root target) | TEST_ENVIRONMENT | refuses and leaves the tree intact | throw ✓ | **no** | PASS |
| **M** selector/harness resolution failure | TEST_ENVIRONMENT | throws `Unsupported QA selector kind` | throw ✓ | **no** | PASS |

**Category I is represented, not literally leaked.** A held loopback socket the
test owns and closes is a faithful stand-in for a leaked child process, and it
proves the detector both fires and clears. No real process was orphaned to
produce this row.

The Electron meta-run's own verdict is recorded at
`.qa-results/week1/week1-20260817T113438Z/injected/injected-fault-report.json`:
`harnessReportedFaultsCorrectly: true`, Playwright stats `expected: 1,
unexpected: 2`, run exit code 1. A zero exit there would have failed Week 1 —
a harness that cannot fail cannot certify anything.

---

## Classification validation

`classifyProbeFailure` was extracted from `manifest-inventory.spec.ts` into
`qa/electron/classification.ts` so it can be exercised with deterministic
fixtures instead of only through a live run. Ten oracle cases plus the
repair-eligibility table are asserted in
`qa/electron/specs/selftest/isolation-and-oracles.spec.ts`.

| Case | Expected | Actual |
| --- | --- | --- |
| Renderer `page-error` present | PRODUCT_BUG | PRODUCT_BUG |
| Renderer crash | PRODUCT_BUG | PRODUCT_BUG |
| Main-process uncaught exception | PRODUCT_BUG | PRODUCT_BUG |
| Plain assertion failure, no environment evidence | PRODUCT_BUG | PRODUCT_BUG |
| `service-startup-failure` diagnostic | TEST_ENVIRONMENT | TEST_ENVIRONMENT |
| `port-conflict` diagnostic category | TEST_ENVIRONMENT | TEST_ENVIRONMENT |
| `EADDRINUSE` in the message | TEST_ENVIRONMENT | TEST_ENVIRONMENT |
| Missing QA fixture | TEST_ENVIRONMENT | TEST_ENVIRONMENT |
| Scenario-manifest drift | TEST_ENVIRONMENT | TEST_ENVIRONMENT |
| `ECONNREFUSED` with only a non-actionable diagnostic | TEST_ENVIRONMENT | TEST_ENVIRONMENT |

Two deliberate biases in the oracle, both stated rather than hidden:

- A bare assertion failure **defaults to PRODUCT_BUG**. That is the aggressive
  direction, and it is safe only because the repair gate then requires a
  reproduction and a root cause before anything can be edited.
- A required service that never started is **TEST_ENVIRONMENT**, not a product
  bug. A run whose service did not come up has learned nothing about
  Breadboard's logic, so it must not become a licence to edit product code.
  This is deliberately conservative: it will occasionally mis-file a genuine
  startup regression as an environment blocker, which costs a human triage step
  rather than an unjustified edit.

### The repair gate is structural

`qa/autonomous/lib/repair-gate.mjs` implements the required interlock:

```text
classification !== PRODUCT_BUG  ⇒  productionSourceMutationAllowed = false
```

It is enforced by code, not by instruction, and it **fails closed** — an
unrecognised classification is denied rather than defaulted. 26 assertions in
`qa/harness-selftest/repair-gate.test.mjs` cover it, including one test per
non-repair classification generated from the enum itself, so a newly added
classification cannot quietly inherit permission.

| Classification | Production source | QA harness | Notes |
| --- | --- | --- | --- |
| `PRODUCT_BUG` | allowed **only** with `reproduced: true`, `attempts ≥ 1`, a root cause, and a responsible code path | allowed | |
| `TEST_ENVIRONMENT`, `QA_FIXTURE_MISSING`, `QA_HARNESS_LIMITATION` | denied | allowed | harness fixes only |
| `EXTERNAL_DEPENDENCY`, `EXPECTED_BEHAVIOR`, `FLAKY`, `OPTIONAL_DEPENDENCY_NOT_CONFIGURED`, `PRODUCT_PREREQUISITE_MISSING`, `INTENTIONALLY_UNSUPPORTED` | denied | denied | scope `none` |
| `MISSING_FEATURE` | denied | denied | always raises a human gate |
| unknown value | denied | denied | fails closed |

Independently of classification, `classifyPath` marks authentication,
capability tokens, permission gates, the Electron preload/sandbox, migrations,
installers/updaters, lockfiles, `.env*`, and credential stores as
**forbidden** — rejected even for a perfectly valid `PRODUCT_BUG` — and
`assertSeedablePath` refuses to let an experiment seed a defect there.

---

## Assertion-integrity validation

`qa/autonomous/lib/assertion-integrity.mjs` reads the candidate unified diff.
It rejects the obvious ways an oracle gets softened, flags ambiguous oracle
edits for a human, and stays quiet about ordinary product edits. 17 assertions
in `qa/harness-selftest/assertion-integrity.test.mjs`.

| Weakening attempt | Verdict |
| --- | --- |
| Net deletion of assertions from an oracle | REJECTED |
| `test.skip` / `fixme` / `todo` introduced | REJECTED |
| `test.only` introduced (anywhere, not just oracles) | REJECTED |
| Timeout inflated beyond 3× an existing bound | REJECTED |
| Exact matcher replaced by `toBeTruthy`/`toBeDefined` | REJECTED |
| `retries` increased | REJECTED |
| Expected-error assertion dropped | REJECTED |
| Empty or ignoring `catch` introduced in an oracle | REJECTED |
| A scenario `successCriteria` entry removed | REJECTED |
| Oracle weakening smuggled inside a *declared* harness fix | REJECTED |
| Modest timeout adjustment (30 s → 45 s) | REVIEW_REQUIRED |
| Any other oracle edit, undeclared | REVIEW_REQUIRED (`undeclared-oracle-change`) |
| Any other oracle edit, declared harness fix | REVIEW_REQUIRED (`declared-harness-oracle-change`) |
| Product fix plus a new regression test | no rejections |

**H-5, a guard defect the experiments found.** The first full experiment run
rejected a perfectly good repair: a brand-new regression test containing
`timeoutMs: 1000` tripped `timeout-inflated`, because the rule compared the
added bound against a removed bound of zero. A new file has nothing to inflate.
The rule now requires an existing bound to inflate, and a first-ever bound above
120 s is *flagged* rather than rejected. Two regression tests cover it. This is
worth recording precisely because it is the failure mode a guard must not have:
a false positive teaches operators to bypass the guard.

The guard's deliberate limitation: it understands a small set of syntactic moves
that reliably mean "the oracle was softened". It does not understand arbitrary
semantic test changes, which is why **every** oracle edit reaches
`REVIEW_REQUIRED` at minimum and never passes silently.

---

## Controlled self-heal experiments

Five seeded defects, each run through the full bounded protocol by
`qa/autonomous/run-repair-experiment.mjs`. All five reached `VERIFIED_REPAIR`;
the seeded defects and their repairs were then discarded with their worktrees,
as intended — the point was to prove the loop can repair, not to keep artificial
fixes. Receipts:
`.qa-results/week1/week1-20260817T113438Z/experiments/receipts/`.

Two design decisions make these experiments non-trivial:

1. **The repair is a forward fix, not a byte-revert to HEAD.** A revert would
   produce an empty production diff and the scope and assertion guards would
   have nothing to inspect. Each repair is a correct implementation written
   against the defective source, so the candidate diff is real.
2. **Every regression test must fail when the defect is reintroduced.** The
   driver re-seeds the defect, reruns the new test, and records the experiment
   as failed if the test still passes.

That second check immediately caught one of my own mistakes — see
`seed-garden-rename-nesting` below.

### 1. `seed-hermes-url-route` — wrong route construction

| | |
| --- | --- |
| Seeded defect | `desktop/src/main/service-definitions.ts`: `` `http://127.0.0.1:${port}` `` → `` `http://127.0.0.1/${port}` ``, so the port becomes a path segment and every consumer probes port 80 |
| Failure | `desktop/tests/service-definitions.test.js` failed on the published Hermes readiness URL; reproduced twice, deterministic, matched the expected signature |
| Classification | PRODUCT_BUG (severity P1) → gate scope `production-source` |
| Root cause | The port separator was replaced by a path separator in the URL template |
| Repair | Destructure the port and rebuild the URL with a colon |
| Regression | `desktop/tests/qa-regression-hermes-url.test.ts` — parses the URL and asserts `url.port === "4305"` and `pathname === "/"`. Passes repaired ✓, **fails with the defect reintroduced ✓** |
| Scenario replay | PASS, in a fresh process after a rebuild |
| Critical replay | Relevant critical subset (desktop service-definition suite) PASS |
| Files touched | `desktop/src/main/service-definitions.ts`, `desktop/tests/qa-regression-hermes-url.test.ts` — **0 unrelated** |
| Result | **VERIFIED_REPAIR** |

### 2. `seed-folder-path-chain` — incorrect pure-data transformation

| | |
| --- | --- |
| Seeded defect | `dashboard/src/lib/cluster-folders.ts`: `segments.slice(0, index + 1)` → `segments.slice(index, index + 1)`, so each breadcrumb entry loses its prefix |
| Failure | `cluster-folder-nesting.test.mjs` failed; reproduced twice, deterministic |
| Classification | PRODUCT_BUG (P2) → `production-source` |
| Root cause | The accumulating slice became a single-element slice, so ancestors were never emitted |
| Repair | Rebuild the chain with a positional filter |
| Regression | `dashboard/tests/qa-regression-folder-path-chain.test.mjs`. Passes repaired ✓, **fails reintroduced ✓** |
| Scenario replay | PASS |
| Critical replay | Relevant subset PASS |
| Files touched | 2, **0 unrelated** |
| Result | **VERIFIED_REPAIR** |

### 3. `seed-garden-rename-nesting` — garden rename/persistence defect

| | |
| --- | --- |
| Seeded defect | `renameFolder` joined the new name onto the **full old path** instead of the parent, so renaming a nested garden buried it one level deeper and orphaned its children |
| Failure | `cluster-folder-nesting.test.mjs` rename cases failed; reproduced twice, deterministic |
| Classification | PRODUCT_BUG (P1) → `production-source` |
| Root cause | `joinFolderPath(from, newName)` where `folderParent(from)` was required |
| Repair | Resolve the parent explicitly, then join |
| Regression | `dashboard/tests/qa-regression-folder-rename.test.mjs` — drives the real `renameFolder` against an in-memory SQLite schema and asserts the garden stays at `Physics/Lectures`. Passes repaired ✓, **fails reintroduced ✓** |
| Scenario replay | PASS |
| Critical replay | Relevant subset PASS |
| Files touched | 2, **0 unrelated** |
| Result | **VERIFIED_REPAIR** (after one rejected attempt — see below) |

**This experiment failed on its first run, correctly.** The original regression
test asserted on `joinFolderPath(folderParent(from), newName)` — a composition
of two helpers that the seed never touched. The defect was inside `renameFolder`
itself, so the test passed with the defect reintroduced and the driver recorded
it as *vacuous*. The test was rewritten to drive `renameFolder` end to end
against a real database. Without the reintroduction check this experiment would
have been reported as a clean success while proving nothing.

### 4. `seed-dialog-wrong-handler` — UI action on the wrong local handler

| | |
| --- | --- |
| Seeded defect | The new-cluster dialog's `<form onSubmit>` rewired from `handleCreateClusterFolder` to `handleRenameClusterFolder` |
| Failure | `cluster-folder-dialog.test.mjs` failed; reproduced twice, deterministic |
| Classification | PRODUCT_BUG (P2) → `production-source` |
| Root cause | Dialog submit bound to the sibling handler |
| Repair | Rebind to the create handler and document why the two dialogs stay separate |
| Regression | `dashboard/tests/qa-regression-cluster-dialog-handler.test.mjs`. Passes repaired ✓, **fails reintroduced ✓** |
| Scenario replay | PASS |
| Critical replay | Relevant subset PASS |
| Files touched | 2, **0 unrelated** |
| Result | **VERIFIED_REPAIR** |

Honest limitation: this oracle is source-level (it reads the TSX and checks the
binding) rather than a rendered-interaction assertion. It is representative of
the defect class and detects it deterministically, but it does not prove the
click behaves correctly at runtime. Upgrading it is a Week 2 item.

### 5. `seed-readiness-predicate` — readiness predicate returns the wrong value

| | |
| --- | --- |
| Seeded defect | `desktop/src/main/health-checker.ts`: `status < 400` → `status < 600`, so a service returning 500 is declared ready and dependents start on top of it |
| Failure | `health-checker.test.js` "http check fails on 500" failed; reproduced twice, deterministic |
| Classification | PRODUCT_BUG (P0) → `production-source` |
| Root cause | The success band was widened to include server errors |
| Repair | `status <= 399` |
| Regression | `desktop/tests/qa-regression-readiness-predicate.test.ts` — stands up real servers returning 500/502/503 and 204. Passes repaired ✓, **fails reintroduced ✓** |
| Scenario replay | PASS |
| Critical replay | Relevant subset PASS |
| Files touched | 2, **0 unrelated** |
| Result | **VERIFIED_REPAIR** (after the H-5 guard false positive was fixed) |

### Experiment summary

| Experiment | Reproduced | Gate | Scope guard | Integrity guard | Replay | Regression detects defect | Unrelated files | Main tree | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `seed-hermes-url-route` | 2/2 deterministic | production-source | REVIEW_REQUIRED | REVIEW_REQUIRED | PASS | ✓ | 0 | unchanged | VERIFIED_REPAIR |
| `seed-folder-path-chain` | 2/2 deterministic | production-source | REVIEW_REQUIRED | REVIEW_REQUIRED | PASS | ✓ | 0 | unchanged | VERIFIED_REPAIR |
| `seed-garden-rename-nesting` | 2/2 deterministic | production-source | REVIEW_REQUIRED | REVIEW_REQUIRED | PASS | ✓ | 0 | unchanged | VERIFIED_REPAIR |
| `seed-dialog-wrong-handler` | 2/2 deterministic | production-source | REVIEW_REQUIRED | REVIEW_REQUIRED | PASS | ✓ | 0 | unchanged | VERIFIED_REPAIR |
| `seed-readiness-predicate` | 2/2 deterministic | production-source | REVIEW_REQUIRED | REVIEW_REQUIRED | PASS | ✓ | 0 | unchanged | VERIFIED_REPAIR |

Every candidate reached `REVIEW_REQUIRED` rather than `ALLOWED`, because every
one added a QA oracle (its regression test). That is the designed outcome: a
repair that touches an oracle always reaches a human.

All five worktrees were removed. In every experiment the seeded file's
fingerprint in the main tree was unchanged, and the regression test never
appeared in the main tree.

---

## Isolation / security validation

Asserted in `qa/electron/specs/selftest/isolation-and-oracles.spec.ts`,
`qa/electron/specs/critical/environment-isolation.spec.ts`, and
`qa/harness-selftest/repair-worktree.test.mjs`.

| Property | How it is proven | Result |
| --- | --- | --- |
| Electron `userData` is isolated | `--breadboard-user-data-dir=<runRoot>/user-data` in the launch args; the path resolves below the run root | PASS |
| Databases, Quartz content, gardens, conversations, artifacts | Every path in `QaRunPaths` asserted inside the run root | PASS |
| Hermes state | `HERMES_HOME` and the empty managed-policy root both below the run root | PASS |
| Downloads | `downloadsDir` below the run root | PASS |
| Terminal working directory / user profile | `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GIT_CONFIG_GLOBAL`, `NPM_CONFIG_USERCONFIG` all asserted below the run root, and `APPDATA` asserted **not equal** to the real profile | PASS |
| Optional runtimes cannot fall back to a shared checkout | `GBRAIN_MODE`, `UI_TARS_MODE`, `CLIPROXY_MODE`, `CAD_MODE` forced `disabled`; optional source/state roots below the run root | PASS |
| No credential leakage into the launch | Credential-like inheritance throws; 30 known provider keys blanked; repository dotenv **keys** shadowed with empty values without reading their values | PASS |
| `ELECTRON_RUN_AS_NODE` cannot bypass the real lifecycle | Deleted from the launch environment; asserted absent | PASS |
| Path traversal / symlink & junction escape | Fixture traversal refused as `forbidden QA path`; runtime root refuses a symlink/junction and a linked ancestor; `assertPathInside` refuses escapes | PASS |
| Child processes belong to this launch | Endpoints file records the owning pid; shutdown observes that exact process | PASS |
| Successful runs release QA-owned ports | `waitForPortsReleased` over dashboard/ChatMock/Quartz; the detector is proven able to fail against a held port | PASS |
| Cleanup cannot delete outside the marker-owned tree | Missing marker, mismatched marker, and a runtime-root target are all refused and leave the tree intact | PASS |
| Failed runs preserve evidence, successful runs clean up | `shouldPreserveQaRun` matrix asserted; the runtime root itself survives | PASS |
| Repairs never touch the main working tree | Worktree tests on a throwaway repository assert byte-identical main tree; each experiment re-verifies within its scope | PASS |
| No credential in textual QA artifacts | `npm run qa:selftest:secrets` over `qa/` and the whole run evidence root: **0 findings** | PASS |

The secret scan reports three files as matching *by design* — they are the
self-test fixtures that carry synthetic secret-shaped literals so the redactor
and the receipt scanner can be proven to catch them. The scanner reports them
explicitly rather than suppressing them, and it **fails** if one of them ever
stops matching, since that would mean the scanner's own coverage regressed.

No test read, wrote, or deleted anything under the real Breadboard profile. The
isolation evidence is positive (every mutable path resolves below the run root
and the environment handed to Electron contains no real-profile path), not an
after-the-fact inspection of the user's data.

---

## Flake / burn-in results

Three consecutive rounds of the deterministic core path, **retries disabled**.
Raw data: `.qa-results/week1/week1-20260817T113438Z/burn-in/burn-in.json`.

| Suite | Runs | Passes | Failures | Flake rate | Median | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `qa:electron:typecheck` | 3 | 3 | 0 | 0.000 | 3.6 s | 4.7 s |
| `desktop:test` | 3 | 3 | 0 | 0.000 | 35.5 s | 36.2 s |
| `qa:selftest` | 3 | 3 | 0 | 0.000 | 7.4 s | 8.0 s |
| `qa:electron:critical` | 3 | 1 | 2 | 0.667 | 391.5 s | 534.6 s |

Per-scenario, across the 13 critical scenarios:

| Scenario | Runs | Passes | Failures | Flake rate | Median | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| a deterministic Markdown fixture ingests through Add documents | 3 | 2 | 1 | 0.333 | 98.9 s | 139.2 s |
| the dashboard terminal opens and closes through visible controls | 3 | 2 | 1 | 0.333 | 24.2 s | 31.9 s |
| the other 11 scenarios | 3 | 3 | 0 | 0.000 | — | — |

**Deterministic failures: 0. Intermittent scenarios: 2.**

The three harness-owned suites are perfectly stable. The instability is entirely
in the live Electron journeys, and it moves around: the baseline failed Markdown
ingestion, round 1 passed everything, round 2 failed the terminal navigation,
round 3 failed Markdown ingestion again. Both failures are UI-timing shaped — a
modal backdrop still intercepting pointer events after an upload completed, and
a `waitForURL` that did not observe a `/dashboard` navigation within 30 s.

Both are therefore **FLAKY** under the contract, and that classification is the
whole point: neither can trigger an automatic production edit, and neither was
repaired. They were *not* quarantined, skipped, retried, or given a longer
timeout — every one of those would have been an assertion-integrity violation
committed by me rather than by a healer.

One honest caveat about the numbers: `qa:electron:critical` is `describe.serial`,
so a scenario that "did not run" contributes no observation. Round 2 and round 3
each left two scenarios unobserved. The 0.333 rates above are therefore lower
bounds on how often those scenarios would fail if always reached, and three
rounds is a small sample. Establishing a real rate needs a longer, non-serial
burn-in — a Week 2 action.

---

## Outstanding blockers

Nothing here blocks the Week 1 exit criteria, but each is a real open item.

**B-1 — Two intermittent critical scenarios (FLAKY, unresolved).** Markdown
ingestion and terminal navigation each failed 1 of 3 rounds. Not root-caused,
not repaired, not quarantined. They make `qa:electron:critical` unreliable as an
automatic gate, which is why the SH1 conditions below do not let it authorise
anything on its own.

**B-2 — The repair gate is not the only writer.** `evaluateRepairGate` and
`enforceChangedFiles` are enforced for everything that goes through
`run-repair-experiment.mjs` and the repair tooling. An agent that edits files
directly still bypasses them. Week 1 proves the gate is correct and
unbypassable *within the repair path*; it does not prove the repair path is the
only path. This is the single most important Week 2 item.

**B-3 — 51 pre-existing `test:dashboard` failures.** Untriaged. Until they are
separated into genuine regressions versus stale oracles, `test:dashboard` cannot
serve as a verification gate for a repair that touches the dashboard.

**B-4 — No seeded experiment was replayed through a full Electron relaunch.**
The five experiments replay their scenario in a fresh process after a rebuild,
and run the relevant critical subset, but the deepest replay layer used was
integration, not a full Electron restart. The Electron-level evidence in Week 1
comes from the injected-fault meta-run and the burn-in, not from an experiment.

**B-5 — The UI-handler oracle is source-level.** `seed-dialog-wrong-handler` is
detected by reading the TSX, not by exercising a rendered click. It reliably
catches that defect class but does not prove runtime behaviour.

**B-6 — `loop-contract.yaml` formal validation is still `NOT_RUN`.** The
contract's own `formal_validation` block records absence of execution. Week 1
did not change that, and `activation_allowed` remains `false`.

**B-7 — Preserved QA run roots accumulate.** 14 directories under the QA runtime
root, 3 from today. All correspond to failed runs under the documented
`on-failure` policy, so this is evidence retention working as designed, but it
needs an age-based sweep before unattended operation.

**B-9 — `local-account-onboarding` failed once, unreproduced.** A 120 s step
timeout in the exploratory inventory, labelled `PRODUCT_BUG` by the oracle but
not repair-eligible without a reproduction, and contradicted by the equivalent
critical scenario passing 3/3. It needs a targeted reproduction attempt in Week
2; it should be treated as part of B-1 until one exists.

**B-8 — `qa:electron:packaged` was not run.** It is *available* — an installed
`Breadboard.exe` exists on this host — but it is outside the Phase 1 suite list
and launching the installed application was not necessary for this
certification. My earlier note calling it environment-blocked was wrong and has
been corrected in the baseline.

---

## Week 1 decision

### Exit criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Fresh current-head baseline exists | **MET** | `BASELINE.md`, `baseline.json` |
| 2 | Harness detects every practically injectable failure type | **MET** | 13 categories, all PASS |
| 3 | Evidence captured correctly | **MET** | screenshot + diagnostics + trace on live failures; evidence gaps reported, not silent |
| 4 | Classification tests pass | **MET** | 10 oracle cases + eligibility table |
| 5 | TEST_ENVIRONMENT cannot trigger product edits | **MET** | gate denies; enforced in code |
| 6 | EXTERNAL_DEPENDENCY cannot trigger product edits | **MET** | gate scope `none` |
| 7 | FLAKY cannot trigger automatic production edits | **MET** | gate denies; and the two real flakes found this week were left unrepaired |
| 8 | Assertion-integrity guard rejects obvious weakening | **MET** | 10 rejection classes, 17 tests |
| 9 | Controlled PRODUCT_BUG experiments detected, reproduced, repaired in isolation, regression-tested, replayed | **MET** | 5/5 `VERIFIED_REPAIR`, each with a non-vacuous regression test |
| 10 | No controlled repair modified the main working tree | **MET** | scoped status + file fingerprints unchanged in all 5 |
| 11 | No repair touched unrelated files | **MET** | `unexpected: []` in all 5 |
| 12 | No QA run touched normal user Breadboard data | **MET** | every mutable path and env var asserted below the run root; real `APPDATA` asserted different |
| 13 | No credential/token in textual QA artifacts | **MET** | 0 findings; 3 synthetic fixtures reported explicitly |
| 14 | No QA-owned processes remain after successful runs | **MET** | port-release assertions in-suite; only failed runs left a preserved run root; no leftover worktrees |
| 15 | No unexplained P0/P1 defect in the Week 1 infrastructure | **MET** | 5 infrastructure defects found (H-1…H-5), all explained and repaired |

### Decision

**READY FOR SH1**

The question Week 1 had to answer was whether the QA system can distinguish
application failure from harness, environment, external, and flaky behaviour,
and self-heal only the first with reproducible evidence. It can, and the
strongest evidence is not the passes:

- The classifier's first verdict on the baseline's Markdown-ingestion failure
  was `PRODUCT_BUG`. Burn-in overturned it to `FLAKY`, and the gate accordingly
  authorises nothing. The pipeline corrected itself before any code was touched.
- The vacuity check rejected a regression test that would have shipped a
  meaningless green (`seed-garden-rename-nesting`).
- The assertion-integrity guard rejected a *legitimate* repair through a false
  positive (H-5) rather than waving it through, and the false positive was fixed
  rather than the guard weakened.
- I attributed a cascade to a harness defect, and the burn-in proved me wrong.
  The correction is in this document.

A system that only ever agreed with itself would not have produced any of those.

SH1 means: the autonomous controller may diagnose a reproduced `PRODUCT_BUG`
and create a candidate repair plus regression test in an isolated worktree.

SH1 explicitly **does not** mean automatic commit, push, PR, merge, or
deployment. None of those are enabled, and nothing in Week 1 was committed.

### Conditions attached to SH1

These are not aspirations; they are the boundary the evidence actually supports:

1. Every repair must run through `run-repair-experiment.mjs` or equivalent
   tooling that calls `evaluateRepairGate` **and** `enforceChangedFiles` **and**
   `reviewAssertionIntegrity`, and must emit a validated receipt. Direct file
   edits outside that path are not covered by this certification (B-2).
2. A candidate whose assertion-integrity verdict is `REJECTED` is discarded, not
   argued with. `REVIEW_REQUIRED` — which every oracle-touching repair
   produces — stops for a human.
3. `qa:electron:critical` may not be the sole verification gate while B-1
   stands. A repair verified only by a suite that fails 2 runs in 3 is not
   verified. Use the relevant deterministic subset plus the scenario replay.
4. A scenario that has failed intermittently stays `FLAKY` until root-caused. It
   may never be repaired, retried, or quarantined automatically.
5. No repair may touch a path `classifyPath` calls `forbidden`, regardless of
   classification, and no seeded experiment may be placed there.
6. `activation_allowed` in `loop-contract.yaml` stays `false` until B-6 is done.

---

## Recommended Week 2 starting actions

In priority order.

1. **Close B-2: make the gated repair path the only writer.** Week 1's gate is
   correct but opt-in. Give the controller a preflight that mints a signed gate
   decision bound to a finding id and an allowed-path set, and require that
   token in the receipt; treat any candidate diff without one as `BLOCKED`. Until
   this exists, SH1 rests on the controller choosing to use the tooling.

2. **Root-cause the two flakes (B-1).** Both are UI-timing shaped: a modal
   backdrop that outlives its upload, and a `/dashboard` navigation that is not
   observed within 30 s. Investigate them as *product* questions — a backdrop
   that lingers after completion is plausibly a real defect, and calling it
   flakiness may be the harness being polite about a bug. Do not raise the
   timeout to find out.

3. **Split `journeys.spec.ts` out of `describe.serial`, or make the burn-in
   report unobserved scenarios explicitly.** Serial mode currently converts one
   failure into missing data for everything after it, which both hides flake
   rates and makes them look better than they are.

4. **Triage the 51 `test:dashboard` failures (B-3)** into genuine regressions
   versus stale oracles. Until that split exists, no dashboard repair can be
   verified against that suite.

5. **Add one seeded experiment that replays through a full Electron relaunch
   (B-4)**, so the deepest layer of the protocol has been exercised end to end
   at least once. The `seed-readiness-predicate` defect is the natural
   candidate: it changes supervisor behaviour and should be observable from the
   startup gate.

6. **Upgrade the UI-handler oracle (B-5)** from source-text matching to a
   rendered interaction, using the headless render approach already in the
   repository.

7. **Run the formal `agent_loop_run` validation of `loop-contract.yaml`
   (B-6)** — validate, score to ≥85, dry-run, render the receipt, privacy-scan —
   and only then revisit `activation_allowed`.

8. **Add an age-based sweep for preserved QA run roots (B-7)**, keeping the
   marker-verified deletion path and never widening it.

9. **Extend the seeded-defect corpus.** Five defects is enough to certify the
   mechanism, not enough to characterise it. Add cases the current guards would
   find hard: a defect whose minimal repair legitimately spans two files, one
   where the correct fix is to *add* an assertion, and one where the right
   answer is "do not repair, this is EXPECTED_BEHAVIOR" — the healer should be
   measured on refusals as much as on repairs.
