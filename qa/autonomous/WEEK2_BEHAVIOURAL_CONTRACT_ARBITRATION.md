# Breadboard W2-3E Behavioural Contract Arbitration

## Decision

**BEHAVIOURAL CONTRACTS CLOSED**

All eleven `ROOT-4B-BEHAVIOURAL` targets were settled at HIGH confidence by
executing the production paths they protect. Closure means the contracts are
arbitrated, not that everything they found is fixed: this pass confirmed a **P1
product defect** that is deliberately left unrepaired and is recorded for a human
decision.

This is not the overall W2-3 decision. 19 rows remain `UNRESOLVED_CONTRACT`.

The headline: unlike `ROUTE_QUERY` and `PROJECTION`, this family was **not**
healthy. Five of the eleven tests are correct and the product is wrong.

---

## Execution identity

| Field | Value |
| --- | --- |
| `baseCommit` | `9e46a6dd9152a1aafa9f3cf5beab9ee9036b91fe` |
| `sourceSnapshotFingerprint` | `f6d2959ec53b9d6e…` |
| `environmentFingerprint` | `13a9343f1161362e…` (unchanged from W2-3D) |
| `executionSnapshotId` | `a79f3827041e188e…` |
| `checkoutLineEndingPolicy` | `core.autocrlf=false`, passed per command |
| Repository `core.autocrlf` | `true` — unchanged, as the developer set it |
| Linked external roots | 64 ignored roots, every HEAD identical before and after |

**The tree moved during the pass and I did not pretend otherwise.** Thirteen
developer files changed after the freeze. All thirteen are disjoint from the
31-file evidence set, and the baseline and final test runs — taken either side of
the movement — produced identical per-test outcomes. The frozen snapshot stayed
the oracle; the movement is recorded as drift in
`source-drift-during-pass.json`.

---

## Target inventory

Eleven targets, read from the W2-3C adjudication file rather than inferred from
names. The W2-3C *contract map* labels only four of them `ROOT-4B-BEHAVIOURAL`
because five keep `previousRootCauseId: ROOT-1` and two keep `ROOT-2`; the
adjudication file is authoritative for family membership, and it lists eleven.

---

## Behavioural sub-roots

Split by the invariant each assertion protects. Two tests in one file landed in
different sub-roots; five tests across two files share one.

### 1. `SKILL_INTEGRITY_PIN` — 5 tests — **PRODUCT_BUG, P1, HIGH**

**Contract.** A reviewed skill whose content has not changed must verify against
its pinned hash on any checkout of the reviewed commit and stay usable. A skill
whose content *has* changed must be refused at every boundary that would ship its
guidance.

**Observable.** sha256 of the shipped bytes against the registry pin; the
`enabled`/`healthy` fields; and the boolean from `skillAvailableForContext`,
which is what actually decides dispatch.

**Positive control.** The gate is correct, and that matters: it refuses a
failed-integrity skill in every partial-failure combination — disabled, unhealthy,
and each on its own — and allows a passing one. All three guidance boundaries
apply it: `super-agent :: skillEntries`, `skillAvailableForContext`, and the
`skill_open` route. `quartz_ai` is never offered either skill.

**Negative case.** Two throwaway worktrees were materialised from HEAD, one per
line-ending policy:

| Skill | Verifies under |
| --- | --- |
| `bullshit-detector` | **no checkout policy at all** |
| `premortem` | `core.autocrlf=true` only |

**Actual behaviour.** Both skills report `enabled: false, healthy: false`.
`/premortem` is refused with *"That capability is unavailable in the current
surface or task mode."* The skills appear installed in the catalog and never work.

### 2. `ARTIFACT_TURN_BINDING` — 1 test — **FIXTURE_BUG, HIGH**

**Contract.** An artifact published by a background run binds to the assistant
turn that asked for it, on both surfaces, and the surface's own transcript can
address that turn.

**Observable.** `artifacts.originating_message_id` and
`chat_messages.canonical_message_id` in a real SQLite database.

**Positive control.** Executed on both surfaces with the real store, the real
publish path, and the real launch ordering — context opened before the turn
exists, so late resolution is genuinely what is under test. The Garden film bound
to its asking turn and the legacy row carried the same canonical id.

**Negative cases.** Two runs in one chat each kept their own turn; a run id
recorded in another conversation did not bind; a run with no recorded turn stayed
unbound rather than adopting a neighbour; a film was invisible to another chat
and to another user.

**Actual behaviour.** The fixture writes the Garden's turn as a raw legacy insert
with `canonical_message_id NULL`, on the stated belief that the Garden does not
use the canonical turn store. It does: `garden-agent-chat.tsx` uses
`useAgentSession("garden_chat")` → the external-turns route →
`recordExternalAgentTurn`, the same function the passing Terminal case calls.
Neither legacy garden chat that PATCHes `/api/chat-sessions` launches an agent.
The fixture asserts against a write path the surface never takes.

### 3. `VISUAL_CONTRACT_VALIDATION` — 2 tests — **FIXTURE_BUG, HIGH**

**Contract.** Implementation dispatch is reachable only for a learner control
contract the model authored and that validates.

**Actual behaviour — the held `learnerAction` item is now settled.** W2-3C left
two readings undecided. They make different predictions, so an experiment
separates them:

- The model **is** asked to author `learnerAction` — the repair prompt says so
  verbatim, the necessity batch carries it, implementation consumes it.
- Omitting any one of the four required fields is refused **with that field
  named**, so it is not a wall.
- Supplying `learnerAction` is necessary but not sufficient: a second gate
  requires `decision.interaction` to equal the projection of the plan exactly.
  That is a *coherence* rule — it stops a later stage re-authoring the model's
  intent — and it has teeth: diverging by one field is refused.
- A contract assembled the way the pipeline assembles one routes to
  `generated_module` and yields a concrete interactive intent, which is exactly
  what both failing tests assert.

**Contract A confirmed, Contract B refuted.** `humanDecisionNeeded` → **false**.

### 4. `CATALOG_CHANGE_ANNOUNCEMENT` — 1 test — **STALE_TEST, HIGH**

**Contract.** Every mutation that changes which models exist announces, and a
picker that has already loaded refetches anyway.

**Actual behaviour.** Both funnels announce. The subscription sync moved to
`settings-accounts.tsx :: syncSubscriptionModels`, because the account list became
the only place a sign-in starts. Executed against a real listener and the real
cache client: 1 → 1 → 2 fetches across a repeat load and an announcement, and a
forced load always hits the network. The provider funnel announces from the shared
`mutate()` helper, so no provider mutation can bypass it.

The assertion counts call sites in one file — something no consumer can observe.

### 5. `WORKSPACE_MATERIAL_ISOLATION` — 1 test — **TEST_EXPECTATION_BUG, HIGH**

**Contract.** The shared `bb-neu-*` material utilities declare only visual
properties.

**Actual behaviour.** All 21 `bb-neu-*` rules were parsed; none declares a motion
or layout property. The invariant holds.

The assertion does not measure those rules. It slices the stylesheet from a
comment to a distant marker, and that window now also contains `.bb-chat-marquee`
and `.bb-garden-card-action:active`. A marquee *must* set `transform` and
`overflow`. The assertion as written expects something that was never intended to
be true, and the window widens every time CSS is added between the two markers.

### 6. `AGENT_RUN_CARD_MATERIAL` — 1 test — **STALE_TEST, HIGH**

**Contract.** The inline card reads as one of the family.

**Actual behaviour.** The card uses 12 shared agent-run classes, every one defined
in the stylesheet, and carries no brand hex colour. Of the four asserted classes
it lacks: `bb-agent-run-icon` is used by **0 of 32** inline agent-run cards and is
**not defined in the stylesheet at all**; `neu-button` and `neu-inset` by 0 of 32;
`bb-agent-run-pill` by 2 of 32.

Satisfying the assertion would mean adding markup for a class that does not exist.

---

## Product bugs

### `W23E-001` — skill integrity pins are computed over bytes git does not preserve

**Severity `P1`** — *a core user journey is completely broken*. Not `P0`: the
control fails closed, so this is an availability defect and not a security bypass,
and the application remains usable.

**Causal chain.**

1. Integrity is verified by hashing the shipped file's bytes against the hash
   pinned in `.agents/skills/registry.json`.
2. The `bullshit-detector` pin equals the sha256 of the build script's raw
   in-memory output, which **mixes line endings** — an LF preamble joined to the
   vendored clone's CRLF body.
3. git normalises the committed blob to LF and, under `core.autocrlf=true`, writes
   CRLF back at checkout. Neither rendering can reproduce a mixed-ending hash.
4. The `premortem` pin equals the CRLF rendering, so it verifies only where the
   checkout writes CRLF.
5. `integrityVerified` is false → `enabled: false, healthy: false`.
6. Every guidance boundary correctly refuses a skill in that state, so the feature
   is completely unavailable.

**Reproduction.** Independent of the first evidence: the first came from the
runtime skill list in the developer's working tree; the reproduction materialised
two fresh checkouts and never read the working copy. Repository and global git
config verified unchanged before and after.

**What is *not* wrong:** the gate, the failure direction, the public-surface
exclusion, and the five tests. They assert the intended behaviour correctly and
should stay red.

---

## SH1 repairs

**None — and this is a decision, not an omission.**

Every viable repair crosses a fence set for this work:

| Option | Change | Why it is held |
| --- | --- | --- |
| **A** (recommended) | Normalise line endings before hashing, in the generator and the verifier | Changes how an integrity control reaches its verdict. *"Do not change security boundaries"* is a standing Week-1 constraint. |
| **B** | Mark `.agents/skills/**` not-text in `.gitattributes` | No weakening at all, but a repository-wide checkout-policy change that W2-3C's instructions discouraged. |
| **C** | Regenerate and re-review the pins | Forbidden by W2-3B, and it does not fix anything: the next clone under the other policy breaks again. |

A QA pass should not quietly rewrite a trust control. The finding carries the full
causal chain, an independent reproduction, three candidate repairs with their
risks, and a regression test for each — everything needed to authorise one.

The counterexample proof deliberately includes the case that makes Option A
defensible: a line-ending-tolerant verifier still rejects changed words, while an
over-normalising one accepts tampered content.

---

## Test expectation bugs

One: `neumorphic-workspaces` (above). The expectation is right; the measurement
window is not, and it drifts.

## Stale behavioural tests

Two: the catalog announcement count and the agent-run card class list. Both are
the same shape W2-3D found — code relocated or vocabulary evolved while the
assertion stayed pinned to the old form.

## Fixture bugs

Three: the ViMax Garden fixture and the two visual-decision-policy tests sharing
one stale helper.

## Harness / fixture findings

**`run-selftest.mjs` under-reports.** It wires four of the seven harness unit test
files, omitting `repair-capability`, `source-snapshot` and `execution-snapshot` —
the libraries that carry capability binding and execution identity. The runner
reports 68 unit tests; the full glob runs **125**, all passing. Reported rather
than fixed: changing the instrument mid-pass would make this pass's own before and
after numbers incomparable. It is the first harness action for the next pass.

Two measurement bugs in my own arbitration, both caught and fixed before any
conclusion rested on them: reading `context.assistantMessageId` *after*
`assistantMessageFor` had written the resolved id back onto it, and a `??`
sentinel that swallowed the genuine `null` it was meant to distinguish.

---

## Counterexample proofs

**21 seeded violations, 21 caught**, controls clean, across all six sub-roots.
Mutations were applied to local stand-ins only. No product file, test file or
repository artefact was modified, and nothing was left seeded.

The ones that matter most: a gate that trusts `availability` alone (unreviewed
guidance ships); a verifier that accepts genuinely tampered content; an
announcement that fires without invalidating the cache (the original defect
wearing a new coat); a resolver that drops the conversation scope (a film binds to
another chat's turn); an artifact lookup that drops the owner scope; and removal of
either the completeness or the coherence check in visual contract validation.

---

## Prediction vs actual flips

Predicted before anything was changed: **zero flips**, because no repair and no
correction would be applied. Observed: **zero flips**, compared by test identity
across 60 named tests, 13 failing before and 13 after, same identities.

A no-flip prediction is still a prediction. Any target changing state would have
signalled the arbitration leaving residue behind — and it confirms nothing was
seeded and forgotten.

---

## Stability

Three independent runs per family, **no retry mechanism**; a differing outcome
would be reported as `FLAKY`, not re-run.

| Family | Attempts | Outcome |
| --- | ---: | --- |
| `SKILL_INTEGRITY_PIN` | 3 | STABLE |
| `ARTIFACT_TURN_BINDING` | 3 | STABLE |
| `CATALOG_CHANGE_ANNOUNCEMENT` | 3 | STABLE |
| `WORKSPACE_MATERIAL_ISOLATION` + `AGENT_RUN_CARD_MATERIAL` | 3 | STABLE |
| `VISUAL_CONTRACT_VALIDATION` | 3 | STABLE |
| counterexamples | 3 | STABLE |

---

## Updated contract map

| State | Before | After |
| --- | ---: | ---: |
| `UNRESOLVED_CONTRACT` | 30 | **19** |
| `ENVIRONMENT_BLOCKED` | 13 | 13 |
| `RESOLVED_STALE_TEST` | 9 | **11** |
| `RESOLVED_HARNESS_BUG` | 10 | 10 |
| `RESOLVED_FIXTURE_BUG` | 5 | **8** |
| `RESOLVED_PRODUCT_BUG` | 0 | **5** |
| `RESOLVED_TEST_BUG` | 0 | **1** |
| **Total** | 67 | 67 |

`RESOLVED_PRODUCT_BUG` means the contract question is settled and the defect is
recorded with a designed repair. It does **not** mean the defect is fixed — those
five tests are still failing, and should be.

---

## Held source-shape policy items

Nothing here decides the policy.

| Held | Count |
| --- | ---: |
| Executable-contract test replacements (W2-3D) | 8 |
| `ROOT-5` case | 1 |
| `UI_SHAPE` rows | 18 |
| **New this pass — category B behavioural corrections** | **3** |
| Category A behavioural corrections (eligible, held for sequencing) | 3 |

The three category-B corrections join the policy set because each would replace a
source-shape assertion with an executable one. The three category-A corrections
are already behavioural and could be applied; they are held only because the
user's own ordering places *"apply approved test corrections"* after the policy
pass, and splitting one reviewable change into two would be worse.

Every correction is designed in `test-corrections.json` with its old contract,
actual contract, evidence, replacement design, non-vacuity plan, and an explicit
*do not do this* — including *do not add a `bb-agent-run-icon` element to satisfy
the assertion*, which would be dead markup for a class the stylesheet never
defines.

---

## Integrity

| Check | Result |
| --- | --- |
| Assertions weakened | **0** |
| Direct product edits | **0** |
| Test files edited | **0** |
| Repository artefacts edited (`.agents/skills`, clones) | **0** |
| Unauthorized mutations | 0 |
| Repository git config changed | **no** — `core.autocrlf` still `true` |
| Global git config changed | no |
| `.gitattributes` added | no |
| Developer tree modified by QA | no — 13 files moved, all by the developer, all disjoint from the evidence set |
| Vendored roots modified | no — 64 ignored roots, every HEAD identical (the environment fingerprint is unchanged) |
| `node_modules` intact | yes (649) |
| User state touched | none — throwaway `BREADBOARD_DATA_DIR` per run, removed after |
| Secret findings | **0** across 37 evidence files and scripts |
| Commit / stash / reset | none |
| Retries / skips / timeout inflation | none |
| Harness self-tests | **125/125** unit, **47/47** Playwright |
| Worktrees left behind | 0 (1 = the main tree) |

---

## Closure rationale

All seventeen criteria hold. Every target was executed against real production
logic (1–2) with a contract written to disk before arbitration began (3) and an
authoritative observable rather than source text, a toast or truthiness (4).
Adversarial cases were executed for every sub-root (5). Every target has a final
classification at HIGH confidence and none is LOW through skipped execution
(6–7). The `PRODUCT_BUG` was independently reproduced from fresh checkouts (8),
and no repair was applied, so SH1 was correctly not entered (9). Every retained
contract has a counterexample proof (10) and stability was measured without
retries (11). No assertion was weakened, no product code repaired, no git config
touched, no vendored root mutated, no user state touched, and no secret entered
the evidence (12–17).

One honest caveat on the authoring discipline: static diagnosis preceded the
written contracts. The mitigation is recorded in the evidence — every FORBIDDEN
clause is taken from the test's own stated intent or a consumer's requirement,
never from observed behaviour, so no contract could be quietly rewritten to match
whatever the product does.

---

## Next action

1. **Authorise or reject the `W23E-001` repair.** It is the only item here that
   blocks real users, and it needs a human decision because every fix touches a
   trust control or checkout policy.
2. **Source-shape test policy**, then apply it in one change across `UI_SHAPE`
   (18), the W2-3D replacements (8), `ROOT-5` (1), and the three category-B
   corrections from this pass.
3. `PROSE_COPY` (7).
4. `ROOT-6` residual contracts (3). The `learnerAction` human-decision item is
   **settled** and comes off that list.
5. Apply the approved test corrections, including the three category-A ones held
   here.
6. `ROOT-8` (13) — one frozen snapshot, both arms.
7. Final dashboard rerun, then close W2-3.

Then ingestion. Not before, and not Week 3.
