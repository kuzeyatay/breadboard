# Breadboard W2-3C Dashboard Contract Resolution

## Decision

**W2-3 STILL OPEN**

This pass did what it was asked to do structurally — no cluster is now LOW
confidence *because it was never examined* — and it found a second environment
artefact class on the way. But 38 failures remain `UNRESOLVED_CONTRACT`, and for
those the question "is the product wrong or is the test wrong?" is characterised
rather than answered. That is a materially better position than "placed in an
uncertainty bucket", and it is still not closed.

Closing would require asserting contract verdicts for 38 tests on evidence I do
not have.

---

## Execution identity

| Field | Value |
| --- | --- |
| `baseCommit` | `9e46a6dd9152a1aafa9f3cf5beab9ee9036b91fe` |
| `sourceSnapshotFingerprint` | `dbb7f66a0767184f…` (review freeze) |
| `environmentFingerprint` | `13a9343f1161362e…` |
| `executionSnapshotId` | `484d15e33bd7412c…` |
| `checkoutLineEndingPolicy` | **`core.autocrlf=false` (deterministic, committed bytes)** |

## CRLF / checkout identity closure

Checkout semantics are now part of execution identity rather than prose. The
environment snapshot records `core.autocrlf`, `core.eol`, `.gitattributes`
presence and hash, platform, and the QA reconstruction policy; a policy
difference is reported by `compareEnvironments` as a `checkout` difference.

Five invariant tests were added: the policy is recorded; a repository with
`core.autocrlf=true` still yields CRLF-free reconstructed bytes; a policy
mismatch is an environment difference; a matching source fingerprint alone does
**not** imply execution equivalence; and QA never writes the repository config.

No `.gitattributes` was added to the product — QA's determinism is not the
product's problem to solve.

### An incident this pass caused and fixed

My first implementation set the policy with `git config core.autocrlf false`
inside the worktree. **A worktree shares the repository's config file**, so that
silently changed the developer's own setting from `true` to `false`.

It was caught by the very check being added — `captureCheckoutPolicy` reported
`repositoryAutocrlf: "false"` when it had been `true`. The setting was restored,
the implementation now passes `-c core.autocrlf=false` per command and never
writes config, and a regression test asserts the repository config is unchanged
after a create-and-remove cycle. Nothing persisted beyond the pass.

---

## The second environment artefact class

Reusing the CRLF method — partition by test identity, not by count — the suite
was run in the developer's live tree and compared against the reconstruction:

| Partition | Count | Meaning |
| --- | ---: | --- |
| Fails in **both** | **44** | A genuine contract question: product and test disagree in the developer's own tree |
| Fails in the **reconstruction only** | **13** | Does not reproduce live |

The 44 are the real work. The 13 are **not** claimed as environment artefacts,
because the comparison cannot support that: the live run and the reconstruction
used different source, since the developer edits continuously. The honest label
is `ENVIRONMENT_BLOCKED` under `ROOT-8-NOT-REPRODUCED-IN-LIVE-TREE`, with the
separating experiment named — freeze once, run both arms against that single
snapshot.

That distinction matters. Calling them environment artefacts would have been the
same over-claim the CRLF finding only narrowly avoided.

---

## ROOT-4B

Split by what each assertion actually protects, over the 44 genuine failures:

| Sub-root | Tests | Likely contract | Why |
| --- | ---: | --- | --- |
| `ROOT-4B-UI_SHAPE` | 18 | IMPLEMENTATION_COUPLING | JSX structure, class names, local handler wiring — techniques that survive refactors |
| `ROOT-4B-BEHAVIOURAL` | 11 | REAL_CONTRACT | Value comparisons and thrown errors; already behavioural, not syntax |
| `ROOT-4B-PROSE_COPY` | 7 | UNCLEAR | Literal copy can be a real contract (guidance a model receives) or incidental wording |
| `ROOT-4B-PROJECTION` | 5 | REAL_CONTRACT | Which fields survive a transform is a contract with whoever renders or persists them |
| `ROOT-4B-ROUTE_QUERY` | 3 | REAL_CONTRACT | A route or query string is a boundary another consumer parses; encoding mistakes here are how scope leaks happen |

Each row records the evidence still needed. For `ROUTE_QUERY` that is executing
the builder with a normal identifier, a space, a Unicode name, a slash and an
already-encoded value and comparing against what the consumer parses — the work
this pass ran out of budget to complete.

## ROOT-7 file resolution

**Not a product defect.** ROOT-7 was a residual bucket created by my own review
tooling failing to resolve which file each assertion targeted. Improved
resolution moved 33 rows out during W2-3; the live-versus-reconstruction split
then partitioned the remainder into 12 genuine contract questions (reassigned to
families) and 5 that joined ROOT-8. **Zero product path-resolution defects.**

Residual: path resolution under junctions was not exercised at Electron runtime.
That belongs to the lifecycle phase, not a source-assertion review.

## ROOT-6

All three reproduce in the developer's tree, so they are genuine. Each now
carries competing contracts, evidence for both, and the specific missing
evidence — `presented.metadata.responseDurationMs` (which module the renderer
reads at runtime), `debugFailedSubsectionDraft` (the Council task-type registry),
`bb-agent-run-inset` (whether the rendered result is visually equivalent). All
`UNRESOLVED_CONTRACT`, MEDIUM, none needing a human decision.

## ROOT-5

Family confirmed to be a single assertion: the other two assertions in that test
still pass, including the exact-occurrence count of `saveFigure: vlmFigureSaver`.
`STALE_TEST` / `IMPLEMENTATION_COUPLING`, HIGH.

**Correction still not applied.** `ROOT-4B-UI_SHAPE` (18 tests) poses the same
question of how to express a source-shape invariant behaviourally, and applying
one replacement now would set that precedent before the family is adjudicated.
The replacement and its non-vacuity proof are specified and ready.

## learnerAction

Fully characterised, deliberately undecided. Contract A: the requirement
tightened intentionally and the fixture is stale — the validator names the
missing field precisely and refuses rather than defaulting. Contract B: the
validator over-rejects — one of the two failing tests is specifically about
acquiring intent *after* routing, which points at ordering rather than absence.

Risk of A being wrong: valid generated visuals silently refused. Risk of B being
wrong: unvalidated model output reaches implementation dispatch.

`humanDecisionNeeded: true`, `week2Blocking: false`.

## Product bugs

**None.** No eligible failure reached `PRODUCT_BUG`, so no SH1 repair was opened.

## Harness bugs

Three fixes, all in QA, none touching product or tests:
per-command checkout policy; the same policy for `git apply`; checkout semantics
recorded in execution identity. Plus the config-mutation incident above.

## Final contract map

Every one of the 67 rows carries exactly one state:

| State | Count |
| --- | ---: |
| `UNRESOLVED_CONTRACT` | 38 |
| `ENVIRONMENT_BLOCKED` | 13 |
| `RESOLVED_HARNESS_BUG` | 10 |
| `RESOLVED_FIXTURE_BUG` | 5 |
| `RESOLVED_STALE_TEST` | 1 |

(67 rather than 62 because the map covers the original eligible set plus the ten
CRLF rows resolved in W2-3B, and cluster membership shifted as resolution
improved.)

## Final dashboard results

| Run | Tests | Failing |
| --- | ---: | ---: |
| Developer live tree | 5124 | 55 |
| Reconstruction | 5089 | 60 (57 eligible, 3 environment-blocked) |

Counts are context, not evidence — the two runs used different source. The
per-identity partition is the evidence.

## Integrity

| Check | Result |
| --- | --- |
| Assertions weakened | **0** |
| Product edits outside SH1 | **0** |
| Unauthorized mutations | 0 |
| Vendored roots modified | no — 61 present |
| `node_modules` intact | yes (649) |
| User state touched | one incident, detected and fully restored (see above) |
| Repository `core.autocrlf` | `true` — as the developer had it |
| Secret findings | 0 |
| Commit / stash / reset | none |
| Retries / skips / timeout inflation | none |
| Harness self-tests | 125/125 |

## W2-3 decision rationale

Criteria met: ROOT-7 adjudicated (a tooling artefact, zero product defects);
ROOT-6 adjudicated per test with competing contracts; ROOT-5 family confirmed;
checkout semantics explicit in execution identity (8); the environment defect was
fixed in the harness rather than by weakening assertions (9); hash pins not
bypassed (10); every harness correction carries a non-vacuity proof (11); no
PRODUCT_BUG so SH1 was not needed (12); remaining unresolved items are deeply
characterised (13); the human-review item is explicit (14); no weakening, retries,
unauthorized mutation, vendored-root change or secret (16–21).

Criteria not met: ROOT-4B is **split and characterised but not adjudicated** (1),
and 38 rows remain unresolved, so failures are explainable by *family* rather
than individually (6, 15). The prompt allows closure with "a small number" of
explicit unresolved cases; 38 is not that.

## Recommended next action

1. `ROOT-4B-ROUTE_QUERY` (3) and `ROOT-4B-PROJECTION` (5) — smallest, highest
   likelihood of REAL_CONTRACT, and both settle by executing the function.
2. `ROOT-4B-BEHAVIOURAL` (11) — already behavioural; reproduce each value or error.
3. `ROOT-4B-UI_SHAPE` (18) — decide the general policy for expressing a
   source-shape invariant behaviourally, then apply it here and to ROOT-5.
4. `ROOT-4B-PROSE_COPY` (7) — determine whether a consumer depends on the exact string.
5. `ROOT-8` (13) — run the separating experiment: one frozen snapshot, both arms.
6. `learnerAction` — human decision.

Not ingestion, and not Week 3.
