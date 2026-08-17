# Breadboard Week 2 Completion Certification

## Decision

**NOT READY FOR WEEK 3**

This pass was asked to optimize for evidence, not for a READY verdict. The
evidence does not support one.

W2-2 moved materially: a repair is now bound to the exact source state that
produced the finding, and a mismatch is refused rather than ignored. That is a
real improvement over Week 2, where repairs were verified against `HEAD` with no
source identity at all.

But the Week 2 completion criteria require executed coverage, and Phases 3
through 8 — ingestion, source/Quartz routing, the persistence matrix, UX/race
abuse, the remaining Electron lifecycle and security cases, and import/export —
were **not executed** in this pass. Nine of the twenty-five READY criteria
therefore remain unmet on the plain reading of "executed". `NOT_EXECUTED` is not
`PASS`, and a decision that treated it as one would be the exact failure this
process exists to prevent.

---

## Source revision

| Field | Value |
| --- | --- |
| `baseCommit` | `91ed121d7709d89c872de63b84d16e55aa3be95c` |
| `sourceSnapshotFingerprint` | `ec91e70d0f895165…` (varies per capture; the tree is edited continuously) |
| Tracked diff in scope | 244 609 bytes across 98 files |
| Untracked source files in scope | 107 |
| Working tree | dirty and **preserved**; nothing committed, stashed, reset or cleaned |

These are two different identities, which is the whole point of this pass. The
commit has not moved all week. The source has moved constantly.

---

## Previous Week 2 blockers

| Id | Previous state | New evidence | New state |
| --- | --- | --- | --- |
| W2-2 repair baseline | NOT MET — repairs cut from `HEAD`, 123 vs 51 failure gap | Source-snapshot model implemented, 15 deterministic tests, live capture/reconstruct/fingerprint match on the real repository, capability bound to the fingerprint | **PARTIAL** — binding proven, full environment equivalence not |
| W2-3 dashboard contract review | NOT MET — 41 left `NEEDS_PRODUCT_CONTRACT_REVIEW` | Not advanced in this pass | **NOT MET** |
| W2-1 unexecuted phases | NOT MET | Not advanced in this pass | **NOT MET** |
| W2-4 two thrown-error failures | Open | Not advanced | **NOT MET** |
| W2-5 upload backdrop | FLAKY, unreproduced ×10 | Not re-investigated; instrumentation retained | Unchanged |
| W2-6 terminal open/close | Open | Not investigated | Unchanged |
| W2-7 rename scenario BLOCKED | Open | Not advanced | Unchanged |
| Critical burn-in | 1 run | Not advanced | **NOT MET** |

---

## W2-2 source snapshot correctness

### How dirty working-tree state is captured

`captureSourceSnapshot` records three things and hashes them into one
fingerprint: the base commit, `git diff HEAD --binary` over the repository minus
generated paths, and every untracked source-extension file in the same scope,
content-hashed. Capture is read-only.

The excluded set is a **deny-list** — `quartz/public`, `gbrain/pglite`,
`node_modules`, and QA's own output directories. An allow-list was tried first
and is worth recording as a failure: it silently dropped real dependencies
(`hermes-skills/prebuilt/*`, `dashboard/package.json`) and produced a worktree
carrying half the developer's change, which failed **more** tests than either
the working tree or `HEAD`. Excluding known generated noise is safe; enumerating
everything a test might read is not.

### How repair state is reconstructed

A detached worktree at `baseCommit`, `git apply` of the captured patch, the
untracked files written back — then the worktree is **re-captured and compared**.
A fingerprint mismatch throws and the worktree is destroyed. Reconstruction
verifies itself rather than asserting success.

### Stale-evidence rejection

`issueRepairCapability` refuses with `stale-source-snapshot` unless the finding's
`sourceSnapshotFingerprint` equals the worktree's. A developer editing a file
between reproduction and repair changes the fingerprint while leaving the commit
identical — the case the previous model could not see at all.

### Unauthorised-change detection on a deliberately dirty worktree

A snapshot worktree is dirty by design, so `git status` no longer isolates what a
repair changed. `finalizeRepairCapability` now compares content manifests taken
before and after, reporting exactly which files moved. Proven both ways: a
smuggled direct write is caught, and the user's in-flight work carried by the
snapshot is *not* misreported as unauthorised.

### Cleanup safety and user-tree integrity

Asserted in the suite and on the live repository: the user's `git status` is
byte-identical before and after capture, reconstruction, mutation and cleanup,
and an untracked in-flight file survives worktree removal. A failed
reconstruction leaves no worktree behind.

### Validation

`qa/harness-selftest/source-snapshot.test.mjs` — **15 tests, 15 passing**,
covering all twelve required cases plus three found while building: manifest
attribution, wrong-base refusal, and the linked-root write guard.

Full harness suite after the change: **111 tests, 111 passing**.

### What is NOT proven

Baseline equivalence. Three measurements, each running the dashboard suite in the
working tree, at clean `HEAD`, and in a reconstructed snapshot:

| Scope | Working tree | Clean HEAD | Snapshot worktree |
| --- | ---: | ---: | ---: |
| Allow-list roots | 52 | 121 | 146 |
| Deny-list, whole repo | 81 | 139 | 169 |
| Deny-list + linked vendored roots | 50 | 120 | 227 |

The snapshot never converged on the working tree, for three independently
sufficient reasons:

1. **There is no stable reference.** The same suite measured 52, 81 and 50
   failures within an hour because the developer is editing throughout.
2. **~98 tests read gitignored vendored clones.** `watermark-tools.test.mjs`
   fails in any worktree because `dashboard/src/lib/watermarks/scripts.ts`
   requires the `watermarks-remover` clone, which `.gitignore` excludes. No
   git-based reconstruction can carry gitignored content.
3. **Linking the clones in made it worse** (227), so they are not
   resolution-neutral. That path is implemented and guarded but left **off by
   default**, because shipping an unvalidated change that degrades the suite
   would be worse than leaving the gap visible.

**Consequence:** a repair whose verification depends on tests reading gitignored
vendored clones must be treated as `BLOCKED`, not verified. The fingerprint
binding means a mismatch can no longer pass silently; environment equivalence
remains open.

---

## W2-3 dashboard contract review

**NOT EXECUTED in this pass.** The 41 failures carried forward from Week 2 remain
`NEEDS_PRODUCT_CONTRACT_REVIEW` with their candidate classifications and
evidence, in
`.qa-results/week2/week2-20260817T130915Z/dashboard-triage.json`. They were not
bulk-classified and were not touched.

---

## Document ingestion

**NOT EXECUTED.** No deterministic PDF, unsupported-extension, corrupt,
duplicate, same-name-different-bytes, multi-file or interrupted-ingestion
fixtures were built or run. The Week 1 fixture blocker remains open.

## Source / Quartz routing

**NOT EXECUTED.** The historical wrong-route defect remains covered only by the
single Week 1 critical scenario.

## Persistence matrix

**NOT EXECUTED beyond Week 2.** The garden rows established in Week 2 stand;
folders, notes, sources, selected-garden and settings remain `NOT_TESTED`, and
no service-restart persistence was exercised.

## UX / race abuse

**NOT EXECUTED.**

## Electron lifecycle

**NOT EXECUTED beyond the inherited Week 1 critical coverage.**

## Security

**NOT EXECUTED beyond the inherited Week 1 coverage.** No security boundary was
modified, and no human gate was reached.

## Service supervision

**NOT EXECUTED.**

## Import / export

**NOT EXECUTED.** Whether the product currently supports a round trip was not
established, so it is recorded as unknown rather than as `NOT_SUPPORTED`.

---

## Product findings

**None.** No new finding reached a reproduced `PRODUCT_BUG` in this pass, so no
SH1 repair was attempted and no product source was modified.

## SH1 repairs

None attempted. The five controlled seeded-defect experiments from Week 2 remain
the only exercised repair path; they were not re-run here, and the capability
changes are covered by unit tests rather than by a fresh end-to-end run. That is
a gap: the snapshot-bound capability has **not** yet been exercised through a
full seeded-defect experiment.

## Critical burn-in

**NOT EXECUTED.** The denominator remains 1 run from Week 2. No new samples.

## Remaining flakes

Unchanged from Week 2: `markdown-upload-ingestion` and
`the dashboard terminal opens and closes` remain intermittent and unexplained;
`local-account-onboarding` retains one unexplained Week 1 sighting.

## Remaining dashboard contract ambiguity

41 failures `NEEDS_PRODUCT_CONTRACT_REVIEW`, 2 `NEEDS_REPRODUCTION`.

## Remaining P0/P1

No P0 identified. The unresolved P1-class items are the three intermittent
critical scenarios and the unproven snapshot/environment equivalence.

---

## Week 3 entry decision

**NOT READY FOR WEEK 3.**

Against the twenty-five READY criteria: criterion 1 is partially met (repairs are
bound to the source state, but equivalence is unproven), criterion 2 is met (a
baseline mismatch can no longer silently invalidate verification), criteria 3,
20–25 are met, and criteria 4–19 are largely **not executed**.

The central question was: *can a reproduced Breadboard bug be repaired against
exactly the same source state that produced it, and is the deterministic
application layer sufficiently exercised that Week 3 Hermes failures will be
attributable?*

The first half now has a real mechanism with real tests behind it. The second
half does not: ingestion, routing, persistence, races and lifecycle are still
unexecuted, so a Hermes failure in Week 3 could not be confidently attributed
above rather than below Hermes.

### Recommended next actions, in order

1. Exercise the snapshot-bound capability through a full seeded-defect
   experiment, so the new path has end-to-end evidence rather than unit evidence.
2. Decide the gitignored-vendored-clone question explicitly: either declare the
   affected tests out of scope for repair verification, or find a reproducible
   way to present the environment. Do not leave it implicit.
3. Then proceed in the stated order: ingestion → routing → persistence → races →
   critical burn-in → remaining lifecycle/security → import/export.
