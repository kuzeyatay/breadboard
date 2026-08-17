# Breadboard QA Week 2 Certification

## Decision

**NOT READY FOR WEEK 3**

Week 3 should begin only when a failure in Hermes, tools or artifacts can be
told apart from a failure in the application underneath. That condition is not
met yet, and the reasons are specific rather than atmospheric:

1. **Most of the Week 2 product scope was not executed.** Phases 2, 5, 6, 7 and
   9 — Electron lifecycle and security, document ingestion, Quartz/source
   routing, import/export round-trips, and UX abuse/races — were not run. They
   are listed as NOT EXECUTED below rather than glossed as partial coverage.
2. **The committed revision is substantially red.** A clean worktree at HEAD
   fails 123 dashboard tests. SH1 repair worktrees are cut from HEAD, so every
   repair is currently verified against that baseline.
3. **The Week 1 intermittent scenarios are not closed.** The upload/backdrop
   scenario did not reproduce in 10 controlled attempts, which is evidence
   against a persistent product defect but is not a root cause.

What *is* closed is the thing Week 2 was told to close first, and it is closed
structurally rather than by convention.

---

## Revision

| Field | Value |
| --- | --- |
| Revision | `91ed121d7709d89c872de63b84d16e55aa3be95c` |
| Branch | `master` |
| Week 1 certification revision | `91ed121d7709d89c872de63b84d16e55aa3be95c` |
| Week 2 run id | `week2-20260817T130915Z` |
| Working tree | dirty and **preserved**; 134+ uncommitted entries, actively edited by the developer throughout the session |
| OS | Windows 11 Enterprise 10.0.26200 (win32 x64) |
| Node / npm | v24.14.1 / 11.12.1 |
| Electron | 33.4.11 |
| Playwright | 1.62.1 |
| TypeScript | 5.9.3 |

Evidence root: `.qa-results/week2/week2-20260817T130915Z/`

---

## Week 1 condition closure

### B-2 — the repair gate is now structurally mandatory · CLOSED

Week 1's weakness was not that `evaluateRepairGate` was wrong; it was that
calling it was optional. The gate is now the **issuer of the only writer**:

```text
diagnose (read-only)
     ↓
issueRepairCapability(finding, worktree, allowedPaths)   ← the full gate runs here
     ↓
applyGatedMutation(capability, path, edit)               ← the only supported write
     ↓
finalizeRepairCapability(capability)                     ← post-diff validation
     ↓
capability consumed; it cannot be used again
```

The teeth are in `finalize`. It compares the worktree's **actual diff** against
the set of files the capability wrote. A direct `fs.writeFileSync`, a shell
redirect, or a patch tool shows up as an unauthorised change, and
`writeReceipt` refuses `VERIFIED_REPAIR` without a finalized capability whose
`findingId` matches the receipt. An ungated repair is therefore impossible to
*certify*, which is the property Week 1 lacked.

This is a correctness boundary inside the QA controller, not an OS sandbox. It
does not stop an arbitrary process from editing a file, and the certification
does not claim it does.

**28 attack tests, 28 denied** (`qa/harness-selftest/repair-capability.test.mjs`,
evidence in `repair-gate-validation.json`):

| Attack | Denial |
| --- | --- |
| mutate with no finding | `no-finding` |
| mutate a TEST_ENVIRONMENT / EXTERNAL_DEPENDENCY / EXPECTED_BEHAVIOR / FLAKY / MISSING_FEATURE failure | `gate-denied` |
| mutate without a reproduction | `gate-denied` |
| mutate without a root cause | `gate-denied` |
| mutate the main working tree | `main-tree` |
| mutate a worktree outside `.qa-worktrees` | `foreign-worktree` |
| replay a stale finding against a newer revision | `stale-finding` |
| name a forbidden trust boundary as an allowed path | `bad-allowed-path` |
| smuggle a QA oracle directory in through `allowedPaths` | `bad-allowed-path` |
| declare an existing oracle as the regression test | `existing-oracle` |
| write outside the allowed paths | `outside-scope` |
| write to a forbidden path inside an allowed directory | `forbidden-path` |
| change a QA assertion with a product capability | `oracle-not-writable` |
| escape the worktree by traversal | `escapes-worktree` |
| reuse another finding's capability / widen its scope / forge it | `bad-signature` |
| reuse after finalize, after revoke, after expiry | `capability-spent` / `expired` |
| bypass with a direct filesystem write | finalize reports `unauthorisedChanges`, repair uncertifiable |
| weaken an existing oracle by direct write | finalize reports `unauthorisedChanges` |

**End-to-end:** all five Week 1 seeded-defect experiments were re-run with every
repair written through the capability. 5/5 `VERIFIED_REPAIR`, every capability
finalized, `unauthorisedChanges: []` in all five, and each receipt now carries
its capability id.

**A real hole this work exposed.** `classifyPath("dashboard/tests")` — the bare
directory — returned `product`, because the oracle patterns are written against
files and require a trailing slash. A repair could have scoped itself over a
directory of assertions. Fixed, with a regression test covering the directory
form of every oracle root.

### B-1 / B-9 — the intermittent scenarios · NOT CLOSED, evidence gathered

Week 1 left three intermittent scenarios. Week 2 investigated the one the
objective singled out and did not accept `FLAKY` as a starting assumption.

**`markdown-upload-ingestion` — the modal/backdrop question.** A dedicated probe
(`qa/electron/specs/investigation/upload-backdrop.spec.ts`) ran the upload
journey **10 times** across two runs with a `MutationObserver` recording every
`.bb-modal-backdrop` attach and detach, and attempted the exact failing click
using Playwright's own actionability check.

| Signal | Result |
| --- | --- |
| Backdrop lifecycle | 10/10 iterations showed exactly one `added`(Add documents) → `removed`(Add documents) pair. No orphan, no second backdrop. |
| Backdrops present after upload | 0 in every point-in-time sample |
| Click interception | `intercepted: false` in 10/10 |

Reading the product code supports this: the upload modal is
`{showUpload && (<div className="bb-modal-backdrop …">…)}` in
`dashboard/src/app/gardens/[clusterSlug]/workspace-client.tsx`, so the backdrop
and its panel mount and unmount together, and `closeUploadModal()` sets
`showUpload` false unconditionally on every path.

**A correction to my own method.** The first probe reported all four iterations
"blocked". That was wrong: it used `document.elementFromPoint` on a link that
sits below the fold, so it reported whatever occupied those viewport
coordinates — the title bar. The probe was corrected to scroll first and to use
Playwright's own hit-testing as the oracle, and the corrected run is what the
table above reports.

**Status: unresolved, not dismissed.** The Week 1 interception is real — it is in
the trace and the run log — but it did not reproduce, and 10 non-reproductions
are not a root cause. It stays `FLAKY` with concrete evidence, and it is **not**
eligible for repair. To make the next occurrence self-diagnosing, the harness
now captures a full inventory of every large fixed/absolute overlay
(class, z-index, `pointer-events`, geometry, headings) into the failure
diagnostics on **any** scenario failure. Week 1 lost a day to not having that.

**`local-account-onboarding` (B-9) — one further sighting, and one false alarm.**
The Week 2 lifecycle spec reproduced a registration hang twice, which initially
looked like independent corroboration. It was not: my new spec called
`registerAndSignIn` in every test against the same disposable account, so the
second registration submitted a taken username and legitimately never navigated.
That is a defect in my test, classified `TEST_ENVIRONMENT` and fixed by
registering once per run root. It is recorded here because reporting it as a
product bug would have been the exact failure mode Week 2 exists to prevent.

---

## Baseline

Full detail in `.qa-results/week2/week2-20260817T130915Z/baseline.json`.

| Suite | Status | Total | Pass | Fail | Skip | Duration |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `qa:electron:typecheck` | PASS | – | – | 0 | 0 | 2.1 s |
| `qa:selftest` | PASS | 95 unit + 47 Playwright | all | 0 | 0 | 4.7 s |
| `desktop:test` | PASS | 140 | 140 | 0 | 0 | 35.0 s |
| `test:dashboard` | **FAIL** | 5044 | 4972 | 51 | 21 | 148.7 s |
| `test:gbrain` | PASS | 47 | 46 | 0 | 1 | 34.8 s |
| `test:ui-tars` | PASS | 66 | 66 | 0 | 0 | 2.0 s |
| `qa:electron:lifecycle` (new) | 4 pass, 1 BLOCKED | 5 | 4 | 0 | 0 | 8.2 m |
| `qa:electron:critical` | PASS | 13 | 12 | 0 | 1 | 7.0 m |
| `qa:electron:explore` | **NOT EXECUTED** | – | – | – | – | – |

---

## Dashboard test triage

`dashboard-triage.json`, 50 failures parsed from the runner's 51 (the one
unparsed entry is recorded rather than silently dropped).

Nothing here was classified from a test's name. Each failure was **placed by
re-running the identical suite in a clean detached worktree at HEAD** and
comparing failure sets — a mechanical discriminator, not a judgement:

| Bucket | Count | Meaning |
| --- | ---: | --- |
| Fails in the working tree **and** at HEAD | 43 | Independent of uncommitted work — the only real-defect candidates |
| Fails only in the working tree | 7 | Caused by in-flight developer edits; passes at HEAD |
| Fails only at HEAD | 80 | **Fixed** by the uncommitted work in progress |

**This overturned my working assumption.** I expected the 51 failures to be
fallout from uncommitted edits. The opposite is true: HEAD fails **123**
dashboard tests against the working tree's 51, so the developer's in-flight work
is net-fixing by a wide margin. It matters operationally because SH1 repair
worktrees are created from HEAD — every repair currently starts from the larger
failure set, and a "relevant existing checks" gate run there will be noisy.

Of the 43 that fail in both: 34 are source-text regex assertions (a pattern
matched against source, not a behavioural check), 7 are value assertions, and
**2 are thrown errors** — the strongest candidates for a genuine defect.

| Status | Count |
| --- | ---: |
| `TRIAGED` (classification G, in-flight work) | 7 |
| `NEEDS_PRODUCT_CONTRACT_REVIEW` (candidates C or G) | 41 |
| `NEEDS_REPRODUCTION` (candidates A or C) | 2 |
| Untriaged | **0** |

I deliberately did **not** force a single A–I letter onto the 41 contract
failures. Deciding "the test is wrong" versus "the code is wrong" requires
reading the product contract each pattern encodes; asserting a letter for 41
tests without that would be precisely the false confidence this process exists
to prevent. Each carries `candidateClassifications`, the evidence for the
narrowing, and a recommended action that explicitly forbids editing either side
without contract evidence.

Five of the 43 touch the deterministic core rather than Hermes/agent surfaces
(`app-theme`, `neumorphic-workspaces`, `quartz-ai-parity`, `vlm-ocr-figures`);
they are flagged `coreAdjacent` for Week 3.

---

## Gardens

A new deterministic project (`qa/electron/specs/lifecycle/`) was authored and run
four times. It is deliberately **not** `describe.serial`: Week 1 showed a serial
group turning one failure into a row of unobserved scenarios.

| Scenario | Status | Runs | Evidence |
| --- | --- | ---: | --- |
| Hostile names mint distinct slugs | **PASS** | 3/3 | Eight names — unicode, emoji, apostrophe, double quote, `/`, `\`, punctuation, 180 chars — each produced a card showing the exact typed name and a slug unique across the set |
| Empty / whitespace-only name rejected | **PASS** | 3/3 | Create stays disabled for both; no garden created |
| Durable across Electron restart | **PASS** | 3/3 | Survives a full relaunch into the same profile, reopens on the same server-minted slug, and Quartz content on disk mentions that slug |
| Rapid switching keeps the right context | **PASS** | 3/3 | Four alternating navigations without waiting for idle; the other garden is never rendered |
| Rename persists across refresh and restart | **BLOCKED** | 0/3 | Could not drive the rename control |

Gardens hold up well against hostile input. The name is preserved byte for byte,
slugs stay unique, whitespace-only names are refused, and a created garden
survives a real Electron restart with its route intact and its content on disk.
The restart and disk checks matter because the renderer cannot fake either.

**The rename scenario is BLOCKED, not FAILED.** Three selector strategies were
tried across three Electron runs — the New-garden modal shape, the garden
settings dialog (`role=dialog`), and the dashboard's own `Edit garden` modal —
and none opened after clicking the card control named "Edit garden". No evidence
was gathered about whether renaming persists, so this says nothing about
Breadboard, and calling it a product failure would be inventing a defect. Its
prerequisite is recorded: a rename path verified against the rendered DOM rather
than inferred from source. Scenario accounting is 100%; BLOCKED is not PASS.

Two defects in **my own** test code were found and fixed along the way, both
classified `TEST_ENVIRONMENT`: re-registering the same disposable account in
every test (which produced two convincing but false registration hangs), and
assuming the edit dialog's shape instead of reading it.

## Folders

**NOT EXECUTED.** No folder scenarios were authored or run in Week 2.

## Notes

**NOT EXECUTED.** No note scenarios were authored or run in Week 2.

## Electron lifecycle

**NOT EXECUTED as a dedicated phase.** The existing `critical` suite exercises
cold launch, welcome gate, renderer refresh, restart with the same profile,
clean shutdown and owned-port release, and those results appear under Flake
analysis. The Week 2 additions the objective asked for — shutdown during an
active request, forced reload during service activity, repeated restart cycles,
duplicate instance, occupied port, startup timeout — were **not** authored.

## Electron security

**NOT EXECUTED as a dedicated phase.** `critical/navigation-security.spec.ts`
covers the historical arbitrary `file:` navigation defect and
`desktop-preload-least-privilege` covers the preload/sandbox posture; both are
inherited from Week 1, not extended. Unknown routes, custom protocols, external
URL policy and IPC surface enumeration were not tested this week.

## Service supervision

**NOT EXECUTED as a dedicated phase.** One unplanned observation is recorded
under Flake analysis: a service health check timed out at 300 s under machine
load, which the classifier correctly placed as `TEST_ENVIRONMENT`.

## Document ingestion

**NOT EXECUTED.** Deterministic PDF, unsupported-extension, corrupt-input,
duplicate-document and interrupted-ingestion fixtures were not built. The
existing Markdown fixture path is exercised only by the Week 1 critical
scenario. Week 1 recorded these as blocked for missing fixtures; that blocker
**remains open**.

## Quartz / source routing

**NOT EXECUTED as a dedicated phase.** The historical wrong-source-route defect
is still covered only by the single Week 1 critical scenario.

## Import / export

**NOT EXECUTED.** No export round-trip was performed.

## Persistence matrix

Partially executed, through the new `lifecycle` project only. See Gardens.

## UX / race testing

**NOT EXECUTED**, apart from the rapid garden-switching scenario in the
lifecycle spec.

---

## Product bugs found

**None.** No finding reached the bar of a reproduced `PRODUCT_BUG` this week, so
no SH1 repair was attempted against a naturally discovered defect and no product
source was modified.

Everything that looked like a bug during Week 2 resolved to something else, and
each is recorded rather than quietly dropped:

| Candidate | Resolution | Classification |
| --- | --- | --- |
| Upload leaves a click-blocking backdrop | Did not reproduce in 10 controlled iterations; backdrop lifecycle clean 10/10 | `FLAKY`, unresolved |
| Registration hangs (two sightings) | My spec re-registered a taken username | `TEST_ENVIRONMENT` (my defect, fixed) |
| Electron workspace failed to start (300 s health timeout) | Machine load while a dashboard suite compiled in a worktree | `TEST_ENVIRONMENT` |
| Rename control unreachable | Three wrong selector strategies | `TEST_ENVIRONMENT` (my defect) |
| 2 dashboard thrown-error failures | Not yet reproduced as runtime scenarios | candidates `A` or `C`, open |

The five `VERIFIED_REPAIR` results in the SH1 statistics are the **controlled
seeded-defect experiments** re-run through the new capability, not repairs of
real defects.

---

## Flake analysis

No intermittent failure is listed here without investigation evidence.

| Scenario | Week 1 rate | Week 2 investigation | Status |
| --- | --- | --- | --- |
| `markdown-upload-ingestion` | 2/3 pass (0.333) | 10 controlled upload iterations, `MutationObserver` on every `.bb-modal-backdrop`, Playwright hit-testing as the oracle: 10/10 clean lifecycle, 10/10 `intercepted: false` | **Unresolved.** Evidence argues against a persistent defect; not a root cause |
| `the dashboard terminal opens and closes` | 2/3 pass (0.333) | **Not investigated this week** | Open |
| `local-account-onboarding` | 1 failure in the Week 1 exploratory run | Two further sightings this week traced to my own test re-registering a taken account | Open; the Week 1 sighting remains unexplained |

One new intermittent observation: a Week 2 Electron launch failed with
`health check timed out after 300000ms` while a dashboard suite was compiling in
a parallel worktree. The next launch came up cleanly in ~20 s. The classifier
placed it `TEST_ENVIRONMENT`, which is correct — a service that never started
teaches nothing about Breadboard — but it does mean Electron startup is
sensitive to machine load, and a 5-minute readiness budget is not generous under
contention.

`qa:electron:critical` was run **once** in Week 2 and passed cleanly — 12 passed,
1 skipped, zero failures, including both scenarios that were intermittent in
Week 1. That is a single sample, not a burn-in: one green run cannot refresh a
flake rate measured over three, and it is recorded here as one observation
rather than as a resolution. The Week 1 rates stand.

**Retries were not enabled at any point, no scenario was quarantined, and no
timeout was inflated.**

---

## SH1 statistics

| Metric | Value |
| --- | ---: |
| Repair attempts | 5 (all controlled seeded-defect experiments) |
| Verified repairs | 5 |
| Failed repairs | 0 |
| Blocked repairs | 0 |
| Capability bypass attempts denied | 28 |
| False-positive repair gates | 0 in this run (one was found and fixed in Week 1) |
| Vacuous regressions caught | 0 in this run (one was caught in Week 1) |
| Assertion-integrity rejections | 0 |
| Mean repair iterations | 1.0 |
| Max repair iterations | 1 |
| Repairs on main-tree product source | **0** |
| Unrelated files changed by a repair | **0** |

No repair was attempted against a naturally discovered defect this week: nothing
reached the bar of a reproduced `PRODUCT_BUG`.

---

## Outstanding blockers

| Id | Blocker | Status |
| --- | --- | --- |
| W2-1 | Phases 2, 5, 6, 7, 9 not executed | Open |
| W2-2 | HEAD fails 123 dashboard tests; repair worktrees start from that baseline | Open |
| W2-3 | 41 dashboard failures need product-contract review before either side is changed | Open |
| W2-4 | 2 dashboard failures are thrown errors and need runtime reproduction | Open |
| W2-5 | `markdown-upload-ingestion` interception unreproduced after 10 attempts | Open, evidence gathered |
| W2-6 | `the dashboard terminal opens and closes` intermittent — not investigated this week | Open |
| W2-7 | Ingestion fixtures (PDF, unsupported, corrupt, duplicate) still missing | Open since Week 1 |
| W2-8 | `loop-contract.yaml` formal validation still `NOT_RUN`; `activation_allowed` remains `false` | Open since Week 1 |
| W2-9 | Preserved QA run roots still accumulate without an age-based sweep | Open since Week 1 |
| W2-10 | `garden-rename-persistence` BLOCKED: no verified semantic path to the rename control | Open |

---

## Known limitations

- The capability gate is a controller boundary, not a sandbox. It makes an
  ungated edit uncertifiable; it does not make one impossible.
- The 41 contract failures were classified as an evidence-backed bucket, not
  individually root-caused.
- The 80 HEAD-only failures were not evaluated individually; they are fixed by
  the working tree and so are not current-state defects.
- The repository was edited by its developer throughout the session, so every
  baseline number is a point-in-time snapshot of a moving tree.
- Machine load materially affects Electron startup: one run hit a 300 s service
  health-check timeout while a dashboard suite was compiling in a worktree.

---

## Week 3 readiness

Not ready. The gate work means an autonomous repair can no longer manufacture a
false green — that half of the Week 2 question is answered, and answered
structurally. The other half is not: the deterministic core has not been
exercised across ingestion, routing, import/export, lifecycle or race
conditions, and the committed baseline is red enough that Hermes-layer failures
could not currently be distinguished from application-layer ones.

The shortest path to Week 3 is W2-2 and W2-3 first — a repair verified against a
123-failure baseline is not verified — then the unexecuted deterministic phases,
in the order ingestion → routing → persistence → races.
