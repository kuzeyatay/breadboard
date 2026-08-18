# Breadboard W2-3 Dashboard Contract Certification

## Decision

**W2-3 STILL OPEN**

The frozen-snapshot review infrastructure works and produced real findings: the
62 eligible failures are now located, clustered into 7 root causes, and two
clusters are fully adjudicated with implementation-level evidence. But 52 of 62
are recorded at LOW confidence as `UNRESOLVED_CONTRACT` — located, not judged.

Closing W2-3 requires each eligible failure to be individually contract-reviewed
against what Breadboard is *intended* to do. Marking 43 assertions `UNCLEAR` in
bulk satisfies the letter of that and not its purpose. Declaring closure here
would be manufacturing exactly the certainty this pass was told not to invent.

---

## Execution snapshot

| Field | Value |
| --- | --- |
| `baseCommit` | `9e46a6dd9152a1aafa9f3cf5beab9ee9036b91fe` |
| `sourceFingerprint` | `8eb3ff733eba3527…` |
| `environmentFingerprint` | `13a9343f1161362e…` |
| `executionSnapshotId` | `3c7911af4cfedcbc…` |

One snapshot, frozen at the start, reconstructed into an isolated worktree with
64 external roots linked. The suite ran there once. Nothing was compared against
the live developer tree, which continued to change throughout.

---

## Initial dashboard baseline

| Metric | Value |
| --- | ---: |
| Tests observed | 5036 |
| Failing entries | 65 |
| Eligible for contract review | **62** |
| Environment-blocked | 3 |
| Cascades linked to a root | 0 |
| Duration | 190 s |

The 62/3 split lines up exactly with the W2-2B two-arm experiment (62 failing in
both arms, 3 linking-damage), which is a useful cross-check: the eligibility map
predicted this split before the run.

## Environment-blocked tests

3, reported separately and never counted as product evidence. The other 62
previously-blocked tests now pass because `linkExternal` is on by default.

## Failure inventory

| Failure type | Count |
| --- | ---: |
| `SOURCE_TEXT_REGEX` | 45 |
| `OTHER_ASSERTION` | 8 |
| `VALUE_EQUALITY` | 4 |
| `THROWN_ERROR` | 4 |
| `FILE_ROLLUP` | 1 |

Each row carries the assertion text, expected/actual where the runner printed
them, a stack excerpt, the source files the test reads, and its eligibility.

## Contract classification totals

| Classification | Count |
| --- | ---: |
| `UNRESOLVED_CONTRACT` | 52 |
| `FIXTURE_BUG` | 9 |
| `STALE_TEST` | 1 |
| `PRODUCT_BUG` | 0 |
| `TEST_EXPECTATION_BUG` | 0 |
| `HARNESS_BUG` | 0 |
| `INTENTIONAL_PRODUCT_CHANGE` | 0 |
| `CASCADE` | 0 |

Confidence: **HIGH 10, MEDIUM 2, LOW 50**.

## Source-contract review

| Kind | Count |
| --- | ---: |
| `REAL_CONTRACT` | 11 |
| `IMPLEMENTATION_COUPLING` | 1 |
| `UNCLEAR` | 43 |
| n/a (not a source assertion) | 7 |

## Root-cause clusters

| Cluster | Tests | Classification | Confidence |
| --- | ---: | --- | --- |
| `ROOT-4-SOURCE-SHAPE-DRIFT` | 25 | `UNRESOLVED_CONTRACT` | LOW |
| `ROOT-7-UNREVIEWED` | 17 | `UNRESOLVED_CONTRACT` | LOW |
| `ROOT-1-GENERATED-SKILL-ARTIFACT-MISSING` | 9 | `FIXTURE_BUG` | **HIGH** |
| `ROOT-6-WIRING-RELOCATED` | 7 | `UNRESOLVED_CONTRACT` | LOW |
| `ROOT-2-VISUAL-CONTRACT-LEARNERACTION` | 2 | `UNRESOLVED_CONTRACT` | MEDIUM |
| `ROOT-3-CAD-CLONE-EXECUTION` | 1 | `UNRESOLVED_CONTRACT` | LOW |
| `ROOT-5-FIGURECOUNT-VARIABLE-RENAME` | 1 | `STALE_TEST` | **HIGH** |

### ROOT-1 — generated skill artifacts are missing (9 tests, HIGH)

The most valuable finding, and it reverses the obvious reading. These tests fail
with `false !== true` on "is a ready installed skill", and with
`No Agency Agent named "aris" is available` thrown from `commands.ts`. That looks
like a registry regression. It is not.

Evidence:

- `hermes-skills/prebuilt/` holds 21 skills; `bullshit-detector`,
  `agent-loop-engineering` and `aris` are **absent entirely**.
- `scripts/build-bullshit-detector-skill.mjs` and
  `scripts/build-diagram-design-skill.mjs` exist as generators.
- Every source clone is present on this machine but gitignored.
- The test's own comment states the contract: *"The registry pins the SKILL.md
  hash, so editing the shipped guidance without re-reviewing it disables the
  skill instead of shipping quietly."*

So the hash-pin integrity mechanism is **working correctly** — it disables a
skill whose reviewed artifact is missing or drifted. The failure is a missing
generated input, classified `FIXTURE_BUG`, with the source contract itself
recorded as `REAL_CONTRACT`.

**Not repaired.** Regenerating these artifacts produces product data and re-pins
reviewed hashes. The pin exists precisely so that regeneration is a reviewed act,
which makes it a developer decision rather than an autonomous QA repair.

### ROOT-5 — `figureCount` variable rename (1 test, HIGH)

`vlm-ocr-figures.test.mjs` asserts the literal `figureCount: vlmFigureCount` in
the ingest route. That literal is gone, but the behaviour is not:

- `ingest/route.ts:783` still defines `vlmFigureSaver`;
- lines 1467 and 1565 still pass `saveFigure: vlmFigureSaver` on both the PDF and
  single-image paths — the same test's assertion of *exactly two* occurrences
  still passes;
- lines 1447/1475/1578 assign `figureCount` from `conversion.imagePaths.length`
  and `vlm.figureCount`;
- line 1959 persists `figureCount`.

The contract — figures are saved as page assets and their count persisted — holds,
across more paths than when the assertion was written. The assertion pinned a
variable name, so it is `IMPLEMENTATION_COUPLING` and the test is `STALE_TEST`.

**Not corrected in this pass**, deliberately: the replacement should land with
the rest of the source-shape-drift cluster so the new assertions are consistent.

### ROOT-2 — visual contract requires `learnerAction` (2 tests, MEDIUM)

`buildVisualizationPlan` throws *"U1: missing model-authored learnerAction"*.
Either the contract tightened deliberately and the fixture is stale, or the
validator over-rejects. Nothing in the repository settled which, and this governs
what reaches implementation dispatch, so it is left `UNRESOLVED_CONTRACT` rather
than picked.

### ROOT-4 / ROOT-6 / ROOT-7 — 49 tests, LOW confidence

Located and characterised mechanically, not adjudicated:

- **ROOT-4 (25)** — asserted identifiers still present, pinned syntax changed.
- **ROOT-6 (7)** — asserted literal absent from the file the test reads but
  present elsewhere in `dashboard/src`: relocation, not removal.
- **ROOT-7 (17)** — asserted file not resolvable automatically, or not a
  source-text assertion.

## Product bugs

**None confirmed.** No eligible failure reached `PRODUCT_BUG` on the evidence
standard, so no SH1 repair was opened.

## SH1 repairs

None. The snapshot-bound path proven in W2-2B was not exercised here because
nothing qualified.

## Test corrections

**None applied.** One (`ROOT-5`) is evidenced and ready; it is held for the pass
that adjudicates its cluster. Applying it alone would have moved the red count by
one without improving the contract picture.

## Runtime arbitration cases

None required. Every determination above came from reading the implementation
and the surrounding contract; no ambiguity reached the point of needing
deterministic runtime arbitration.

## Remaining unresolved contracts

52, each with its ambiguity, competing interpretations, and the evidence that
would settle it recorded in `dashboard-contract-review.json`.

## Final dashboard baseline

Unchanged: 65 failing of 5036 (62 eligible, 3 environment-blocked). The suite was
not re-run, because no source changed and re-running would imply work that did
not happen.

**No unexplained failures**: every one of the 62 has a classification, a root
cause and an evidence trail. 52 are explained as *not yet adjudicated*, which is
a weaker statement than "explained" and is reported as such.

## Verification eligibility

62 eligible / 3 environment-blocked, consistent with the W2-2B map.

## Integrity

| Check | Result |
| --- | --- |
| Main tree modified by SH1 | no — no repair opened |
| User files touched | no |
| Unauthorized changes | none — no capability issued |
| Assertion weakening | none |
| Retries / timeout inflation / skips added | none |
| Secret findings | 0 |
| Vendored roots modified | no |
| `node_modules` intact | yes |
| Committed / stashed / reset | no |
| Harness self-tests | 120/120 passing |

## Decision rationale

Against the eighteen `W2-3 CLOSED` criteria: one frozen snapshot was used (1);
cascades are linked (3); environment-blocked tests stay separate (4); every
source-contract assertion carries a kind (6); no `PRODUCT_BUG` arose so (7) and
(8) are vacuously satisfied; no test was corrected without evidence (9); nothing
was deleted (10); unresolved contracts are explicit (11); no weakening, retries
or skips (12, 13); no user state, vendored dependency, unauthorized mutation or
secret (14–17).

Criterion 2 — *every eligible independent failure individually classified* — and
criterion 5 — *no unexplained eligible failure* — are the ones that fail on their
intent. 52 failures carry a placement, not a judgement. Criterion 18 asks the
remaining baseline to be explainable test by test; it is explainable as *located*,
not as *adjudicated*.

W2-3 stays open.

## Recommended next action

Continue W2-3 rather than moving on. In order:

1. **ROOT-4 (25 tests)** — the largest cluster and the most mechanical: for each,
   decide `REAL_CONTRACT` versus `IMPLEMENTATION_COUPLING`. Many will resolve the
   way ROOT-5 did once the implementation is read.
2. **ROOT-7 (17)** — improve asserted-file resolution so these stop landing in a
   residual bucket, then review.
3. **ROOT-6 (7)** — trace each relocation and decide whether the test should
   follow it or whether an invariant broke.
4. **ROOT-2 (2)** — settle when `learnerAction` became mandatory.
5. **ROOT-1 (9)** — a developer decision on regenerating and re-pinning the
   skill artifacts; QA should not make it.

Only then: ingestion → routing → persistence → races → lifecycle/security →
import/export → critical burn-in → Week 2 recertification. Not Week 3.
