# Breadboard W2-3B Dashboard Contract Adjudication

## Decision

**W2-3 STILL OPEN**

One cluster was resolved decisively and it was the most important kind of result:
ten failures that looked like contract drift were a **QA harness defect**, and
adjudicating them "properly" without that discovery would have weakened ten real
assertions to make an environment artefact disappear.

But 45 of 57 remaining eligible failures are still LOW-confidence
`UNRESOLVED_CONTRACT`. The closure bar explicitly forbids leaving a cluster at
LOW confidence *because it was not investigated*, and ROOT-4B (24) and ROOT-7
(17) are exactly that. W2-3 stays open.

---

## Execution snapshot

| Field | Value |
| --- | --- |
| `baseCommit` | `9e46a6dd9152a1aafa9f3cf5beab9ee9036b91fe` |
| `sourceFingerprint` | `dbb7f66a0767184f…` (review freeze) |
| `environmentFingerprint` | `13a9343f1161362e…` |
| `executionSnapshotId` | `484d15e33bd7412c…` |

The post-fix verification run froze its own snapshot (`9a9bd282b3083902…`)
because the developer edited between the two. That is why the aggregate count is
**not** used as the evidence below — the per-test check is.

## Previous unresolved state

62 eligible failures, 52 `UNRESOLVED_CONTRACT` at LOW confidence, 7 clusters,
zero product bugs, zero corrections.

---

## Root-cause adjudications

| Cluster | Tests | Contract type | Classification | Confidence | Action |
| --- | ---: | --- | --- | --- | --- |
| `ROOT-4A-CRLF-CHECKOUT-NORMALISATION` | 10 | IMPLEMENTATION_COUPLING | **HARNESS_BUG** | HIGH | **Fixed** |
| `ROOT-1-GENERATED-SKILL-ARTIFACT-MISSING` | 9 | REAL_CONTRACT | FIXTURE_BUG | HIGH | Developer review |
| `ROOT-5-FIGURECOUNT-VARIABLE-RENAME` | 1 | IMPLEMENTATION_COUPLING | STALE_TEST | HIGH | Held for ROOT-4B |
| `ROOT-4B-SOURCE-SHAPE-DRIFT-REMAINDER` | 24 | MIXED | UNRESOLVED_CONTRACT | LOW | Split and adjudicate |
| `ROOT-7-UNREVIEWED` | 17 | UNCLEAR | UNRESOLVED_CONTRACT | LOW | Resolve asserted files |
| `ROOT-6-WIRING-RELOCATED` | 3 | UNCLEAR | UNRESOLVED_CONTRACT | LOW | Trace relocations |
| `ROOT-2-VISUAL-CONTRACT-LEARNERACTION` | 2 | REAL_CONTRACT | UNRESOLVED_CONTRACT | MEDIUM | Human decision |
| `ROOT-3-CAD-CLONE-EXECUTION` | 1 | UNCLEAR | UNRESOLVED_CONTRACT | LOW | W2-2B blocker E-2 |

---

## ROOT-4 deep review

ROOT-4 was **not one contract**. Reading all 25 assertions showed at least three
families — prose pinned in markdown skill guidance, React/JSX structure, and
route/query/data-projection contracts — so it was split.

### ROOT-4A — the finding

Three assertions pinned prose across a line break in skill markdown. The obvious
reading was that the developer rewrote the guidance: `i-have-adhd/SKILL.md` *is*
modified in the working tree, and substantially — the guidance changed from
"name ONE concrete next action" to "never manufacture a task to close on".

That reading was wrong. The asserted sentence was still there, at line 99–100,
word for word.

The discriminator was inside the same test file: two assertions against the same
markdown, one passing and one failing. The passing one used a newline-tolerant
form; the failing one pinned a bare newline. That only matters if the file has
carriage returns.

Byte-level measurement settled it:

| Location | CRLF | bare LF |
| --- | ---: | ---: |
| Developer working tree | 0 | 229 |
| Default `git worktree` checkout | 223 | 0 |

The repository sets `core.autocrlf=true` and has no `.gitattributes`, so every
worktree checkout rewrites text files to CRLF, while the developer's tree holds
whatever their editor wrote. A bare newline in a pattern cannot match `\r\n`.

**These ten tests passed for the developer and failed in every QA
reconstruction, for reasons that had nothing to do with Breadboard.**

Note what this means for the earlier passes: the source *fingerprint* matched,
because `git diff` normalises line endings. Source identity and byte-level
checkout fidelity are not the same thing, and this is the third distinct identity
gap this Week-2 sequence has surfaced.

**The fix is in the harness, not the tests.** Reconstruction worktrees now check
out with `core.autocrlf=false`, so they carry committed bytes. No assertion was
touched.

**Non-vacuity proof.** The ten affected tests were predicted from static pattern
analysis *before* the change. After it, all ten flipped FAIL → PASS, verified by
test identity rather than by counting; reverting the flag reproduces them.

### ROOT-4B — the remainder (24, LOW)

Genuinely mixed and not adjudicated. Sampling shows both ends of the spectrum:
`/api/hermes/sessions?surface=${encodeURIComponent(surface)}` is route
construction and probably a REAL_CONTRACT, while a pinned
`<div className="flex min-w-0 flex-1 flex-col">` is probably coupling. They need
splitting by family, route and data-projection first.

---

## Runtime arbitration

One case, settled deterministically: the CRLF measurement above. No other cluster
reached the point of needing it — the remaining ones are unexamined, not
ambiguous-after-examination.

## Git-history evidence

Used once, and it argued *against* the conclusion it might have supported. The
`i-have-adhd` guidance rewrite proved the developer was actively changing skill
content, which made "the test is stale" tempting. Byte-level evidence overrode
it. Age was never used to mark a test stale.

## Product bugs

**None.** No eligible failure reached `PRODUCT_BUG`. The largest resolved cluster
turned out to be a defect in the QA harness itself.

## Test expectation bugs

None identified.

## Stale tests

One: `vlm-ocr-figures` (`ROOT-5`, HIGH). **Not corrected** — Phase 6 forbids
partial easy wins while its family is unadjudicated.

## Fixture bugs

Nine (`ROOT-1`, HIGH): the reviewed skill artifacts are absent, so the hash-pin
mechanism correctly disables the skills. Per Phase 12, option **D** applies — the
tests already assert that missing artifacts stay disabled, so no test change is
warranted. Nothing was regenerated, re-pinned, or marked reviewed.

## Intentional product changes

None claimed. The one candidate (the `i-have-adhd` rewrite) did not explain its
test failure, so it was not used as a classification.

## Remaining unresolved contracts

Each records competing interpretations in `cluster-adjudications.json`. The
sharpest is `ROOT-2`: either the visual contract deliberately tightened to
require a model-authored `learnerAction` and the fixture is stale, or the
validator over-rejects. Missing evidence: when the field became mandatory. It
governs what reaches implementation dispatch, so it is a human decision.

`ROOT-4B`, `ROOT-6`, `ROOT-7` and `ROOT-3` remain LOW because they were not
examined per test in this pass — stated plainly rather than dressed up.

## Reviewed artifact / hash-pin findings

The pin behaved exactly as designed. No hash was changed, no artifact
regenerated, no generated content accepted as reviewed.

## Corrections applied

One, in the harness: `repair-worktree.mjs` checks out with `core.autocrlf=false`.
Zero product edits, zero test edits, zero assertions weakened.

## SH1 repairs

None. Nothing qualified as a `PRODUCT_BUG`.

## Final dashboard baseline

| Bucket | Before | After |
| --- | ---: | ---: |
| Eligible failures | 62 | **57** |
| Environment-blocked | 3 | 3 |
| Tests observed | 5036 | 5089 |

The aggregate is **not** the evidence: the developer edited between snapshots, so
62 → 57 is not cleanly attributable. The attributable result is per-test — 10 of
10 predicted tests fixed.

Of the 57: 10 HIGH-confidence classified, 2 MEDIUM, 45 LOW `UNRESOLVED_CONTRACT`.

## Integrity

| Check | Result |
| --- | --- |
| Assertion weakening | **0** |
| Unauthorized mutation | 0 — no capability issued |
| User state touched | no |
| Vendored roots touched | no — 61 present, unmodified |
| `node_modules` integrity | intact (649 entries) |
| Secret findings | 0 |
| Commit / stash / reset | none |
| Retries / skips / timeout inflation | none |
| Harness self-tests | 120/120 |

## Decision rationale

Criteria 6–14 hold: the hash-pin mechanism was not bypassed, no
implementation-coupled test was preserved for red-count reasons, the one harness
correction carries a non-vacuity proof, no assertion was weakened, no user or
vendored state was touched, no secret appears.

Criteria 1–3 do not. ROOT-4B and ROOT-7 — 41 of 57 — were not adjudicated, and
criterion 2 explicitly forbids closing with clusters left LOW "solely because
they were not investigated". That is precisely their status.

The pass advanced the question materially: it removed the single largest source
of *false* contract signal, and it did so by finding that the QA environment, not
Breadboard, was wrong. It did not finish the adjudication.

## Recommended next action

Continue W2-3 adjudication:

1. **ROOT-4B (24)** — split by family; do route/query construction and data
   projection first, where a REAL_CONTRACT is most likely.
2. **ROOT-7 (17)** — improve asserted-file resolution so these leave the residual
   bucket, then adjudicate.
3. **ROOT-6 (3)** — trace each relocation.
4. **ROOT-2 (2)** — human decision on `learnerAction`.
5. Then apply the held `ROOT-5` correction together with its family.

Only after that: ingestion → routing → persistence → races → lifecycle/security →
import/export → critical burn-in → Week 2 recertification. Not Week 3.
