# Breadboard W2-2B Snapshot Equivalence Certification

## Decision

**W2-2 CLOSED**

Not because the repository is hermetic — it is not — but because Breadboard now
knows *which* inputs produced a finding, can reconstruct them, and fails closed
wherever it cannot. 65 dashboard tests remain `ENVIRONMENT_BLOCKED`, and that is
recorded as a boundary rather than papered over.

The closing evidence is two experiments that were previously impossible: a
controlled equivalence measurement with no moving oracle, and a complete seeded
`PRODUCT_BUG` driven through the snapshot-bound capability to
`VERIFIED_REPAIR`, alongside a deliberately non-equivalent twin that was refused.

---

## Frozen execution snapshot

| Field | Value |
| --- | --- |
| `baseCommit` | `9e46a6dd9152a1aafa9f3cf5beab9ee9036b91fe` |
| `sourceFingerprint` | `7cbc979c7c05d0cf…` |
| `environmentFingerprint` | `13a9343f1161362e…` |
| `executionSnapshotId` | `08d22227c8f9e535…` |
| Gitignored roots on this machine | 64 (61 vendored clones plus runtime dirs) |

`baseCommit` moved during this pass — the developer committed — which is exactly
the drift the model exists to absorb. The environment fingerprint stayed
constant across both experiments while the source fingerprint changed, which is
the separation working.

---

## Environment dependency inventory

Static analysis (`environment-dependencies.json`) follows each dashboard test
through its local imports to depth 2 and records references to root-level
gitignored directories **in filesystem context** — a path being built or read,
not a string constant naming an integration.

A first attempt matched any quoted occurrence and flagged 264 of 421 test files.
That was noise: source is full of constants like `"opencode"` that never touch
the directory. Tightened to filesystem context, it reports 186 files and 305
dependency edges, and it correctly identifies the known-true case
(`watermark-tools.test.mjs` → `watermarks-remover`).

The static pass is a hypothesis generator. The authority is the experiment below.

---

## Gitignored dependency findings

The 62 environment-divergent tests name their own cause. Top signatures:

| Count | Signature |
| ---: | --- |
| 26 | `ENOENT: no such file or directory, open '…\.qa-worktrees\…'` |
| 5 | `WatermarkError: The watermarks-remover scripts are not installed at …` |
| 2 | `ENOENT: … scandir '…\.qa-worktrees\…'` |
| 1 | `the DeepTutor clone should be found next to the dashboard` |
| 1 | `AudioAnalyzerError: The audio analyzer is not installed on this machine` |

Concentrated in `watermark-tools` (8), `paper-trader-agent` (6),
`document-skills` (4), `vibe-trading-agent` (4), `audio-analysis` (3). These are
`GITIGNORED_REPO_DEPENDENCY`: git never carries them, so no worktree can.

---

## Why linked clones diverged

**The previous conclusion was wrong, and the earlier measurement was confounded.**

The prior pass measured linking as harmful (227 failures against 120 at `HEAD`)
and disabled it. That comparison had three defects: it ran against a developer
tree being edited throughout, it changed snapshot scope in the same step, and —
decisively — it ran while worktree cleanup still recursed *through* junctions and
deleted the real `node_modules`, so subsequent runs executed against damaged
dependencies. That cleanup bug has since been fixed (`unlinkNestedLinks` drops
links before removal).

A controlled two-arm experiment settles it. One frozen snapshot; both arms
reconstruct it, so authored source is byte-identical (`fingerprintsIdentical:
true`); the only variable is whether the ignored roots are present:

| Arm | Environment | Failing | Tests observed |
| --- | --- | ---: | ---: |
| A | source only — what a repair worktree got | **124** | 4939 |
| B | source + ignored roots junctioned | **65** | 5031 |

| Comparison | Count |
| --- | ---: |
| Fail in both, identical signature | 60 |
| Fail in both, different signature | 2 |
| **Environment divergence** (fails without roots, passes with) | **62** |
| **Linking damage** (passes without roots, fails with) | **3** |

Linking fixes 62 and changes 3 — the opposite of the earlier reading. Arm B also
*observed* 92 more tests, because several files cannot even load without the
clones, so their tests never register.

The 3 linking-damage cases were inspected rather than counted: two are
`parametric-cad-integration` tests that only become executable once the CAD clone
exists (they were not previously passing so much as not running), and one is a
`map-hermes-wiring` source-text assertion. All three are treated as
`ENVIRONMENT_BLOCKED` regardless of direction.

**Consequence:** `linkExternal` now defaults to **on**, with the evidence and the
reversal recorded at the call site.

---

## Dependency policy

| Policy | Count | Applies to |
| --- | ---: | --- |
| `CAPTURE` | 0 | — |
| `REFERENCE_READ_ONLY` | 2 | gitignored vendored roots; `node_modules` trees |
| `RECONSTRUCT` | 0 | — |
| `EXCLUDE_FROM_VERIFICATION` | 1 | `quartz/public`, `gbrain/pglite` (generated) |
| `BLOCK` | 1 | secrets, credentials, userData, gardens, browser profiles |

`REFERENCE_READ_ONLY` is only defensible because the read-only property is
enforced, not assumed: `applyGatedMutation` resolves real paths before writing
and denies anything whose parent resolves outside the worktree, so a repair
cannot write through a junction into a developer clone. A dedicated test asserts
the denial *and* that the developer's copy is byte-identical afterwards.

---

## Verification eligibility map

| Status | Count |
| --- | ---: |
| `ELIGIBLE` | **4874** (98.68%) |
| `ENVIRONMENT_BLOCKED` | 65 across 36 files |
| `UNRESOLVED` | 0 |

The rule, enforced in `verification-eligibility.mjs`: a repair may reach
`VERIFIED_REPAIR` only if its scenario, regression test, targeted suite and
critical subset are all `ELIGIBLE`. A blocked test may execute diagnostically and
can **never** supply positive evidence.

This replaces "the dashboard suite had a large red number" with "these 4874 tests
are valid verification evidence."

---

## Frozen-reference equivalence results

| Classification | Count |
| --- | ---: |
| `MATCH_FAIL` (same signature) | 60 |
| `MATCH_FAIL` (different signature) | 2 |
| `ENVIRONMENT_DIVERGENCE` | 62 |
| `LINKING_DAMAGE` | 3 |
| `EXPECTED_BLOCK` | 65 (the union, now mapped) |
| `UNRESOLVED_DIVERGENCE` | 0 |

Compared per test and per failure signature, never by totals. Two failures are
not equivalent merely because both are red — which is why the 2 same-test
different-signature cases are reported separately rather than folded into
`MATCH_FAIL`.

---

## End-to-end seeded SH1 experiment

Seeded defect: the readiness predicate in `desktop/src/main/health-checker.ts`
widened to accept 5xx — pure, local, deterministic, and clear of auth, sandbox,
capability tokens, installers, migrations, providers and the vendored-clone area.

| Step | Result |
| --- | --- |
| Execution snapshot frozen | `08d22227c8f9e535…` |
| Reconstruction fingerprint matched | ✅ (64 roots linked) |
| Reproduction | 2/2, deterministic |
| Classification | `PRODUCT_BUG` |
| Verification eligibility | eligible, nothing blocked |
| Capability issued | bound to `sourceFingerprint` |
| Repair | through `applyGatedMutation` only |
| Regression non-vacuous | passes repaired ✅, **fails with defect reintroduced** ✅ |
| Exact scenario replay | ✅ |
| Critical verification (`desktop:test`, 140 tests) | ✅ |
| Assertion integrity | `REVIEW_REQUIRED` (adds an oracle, as designed) |
| Capability finalized | ✅ |
| Unauthorised changes | **[]** |
| Seeded file in main tree | unchanged |
| Regression test leaked to main tree | no |
| **Final status** | **`VERIFIED_REPAIR`** |

Receipt: `repair-receipts/w22b-sh1-positive.receipt.json`.

## Negative environment-gate experiment

The identical defect, but declaring an `ENVIRONMENT_BLOCKED` test as required
verification:

| Field | Value |
| --- | --- |
| Final status | **`BLOCKED`** |
| Reason | `verification-suite-blocked` |
| Capability requested | **no** — it failed closed before any mutation |
| `VERIFIED_REPAIR` emitted | **never** |

Ambiguity fails closed, and it fails *before* the writer exists rather than after
the fact.

---

## Moving working-tree safety

Proven in `execution-snapshot.test.mjs`: after freezing snapshot A, source is
edited and a new file added; a reconstruction of A still yields A's fingerprint,
the post-freeze file is absent, and a finding from A against a worktree carrying
B is refused with `stale-source-snapshot`. No developer work was altered or
discarded to run this.

## TOCTOU validation

| Case | Result |
| --- | --- |
| Source changed after the finding | rejected `stale-source-snapshot` |
| Worktree reconstructed from the wrong snapshot | rejected `stale-source-snapshot` |
| Vendored clone removed after freeze | detected, `environment-not-equivalent` |
| Required test environment-blocked | denied `verification-suite-blocked` |
| Capability reuse / expiry / forgery | denied (Week 2 suite, still passing) |

## User-tree integrity

- `git worktree list` = 1; `.qa-worktrees` empty.
- `node_modules` intact: 6 / 649 / 210 entries. This mattered: the junction
  recursion bug had been emptying the real `dashboard/node_modules`.
- All 61 vendored clones present and unmodified.
- Seeded file and regression path individually fingerprinted before and after
  both experiments: unchanged, not leaked.
- Nothing committed, stashed, reset or cleaned.
- Whole-tree `git status` did drift during runs — the developer was editing
  Hermes files throughout. That is external activity, checked per-path rather
  than treated as a QA violation.

Harness suites: **120 tests, 120 passing**. Secret scan: **0 findings**.

---

## Remaining blockers

| Id | Blocker |
| --- | --- |
| E-1 | 65 tests `ENVIRONMENT_BLOCKED`; ineligible as verification evidence |
| E-2 | 3 linking-damage cases not individually root-caused (2 look like tests that only execute once the CAD clone exists) |
| E-3 | 2 tests fail in both arms with *different* signatures — unexplained |
| E-4 | Vendored clones without their own `.git` have presence-only identity, so an in-place edit to one would not move the environment fingerprint |
| E-5 | Everything from the prior pass stands: dashboard contract review, ingestion, routing, persistence, races, lifecycle, import/export, burn-in |

---

## Decision rationale

Against the fifteen `W2-2 CLOSED` criteria: a frozen reference is used (1); live
edits after freeze provably do not move it (2); source and environment identity
are separate and separately fingerprinted (3); escaping dependencies are
inventoried statically and confirmed experimentally (4); affected tests are
explicitly eligible or blocked (5); a blocked test cannot contribute positive
evidence, enforced in code and demonstrated by the negative arm (6);
reconstruction matches or blocks (7); a full seeded `PRODUCT_BUG` completed
through snapshot, reproduction, capability, repair, non-vacuous regression, exact
replay and finalization (8); it reached `VERIFIED_REPAIR` only with eligible
tests (9); the non-equivalent twin was rejected (10); the user tree is untouched
(11); ignored clones unmodified (12); no source or environment mismatch can
produce `VERIFIED_REPAIR` (13); unauthorised changes `[]` (14); no assertion
weakening, no retries, no timeout inflation (15).

W2-2 is closed with 65 tests explicitly out of bounds. That is a better position
than claiming a hermetic repository, and it is honest about where the boundary
sits.

---

## Recommended next execution order

1. Dashboard contract review (41 `NEEDS_PRODUCT_CONTRACT_REVIEW`, 2 `NEEDS_REPRODUCTION`)
2. Deterministic ingestion
3. Source / Quartz routing
4. Persistence matrix
5. Race abuse
6. Electron lifecycle / security completion
7. Import / export
8. Critical burn-in (denominator is still 1)
9. Week 2 recertification

Not Week 3. The deterministic core beneath Hermes is still largely unexercised.
