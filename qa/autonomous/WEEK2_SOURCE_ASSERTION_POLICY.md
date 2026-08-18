# Breadboard W23E-001 + Source Assertion Policy

## Execution identity

| Field | Value |
| --- | --- |
| `baseCommit` | `9e46a6dd9152a1aafa9f3cf5beab9ee9036b91fe` |
| `sourceSnapshotFingerprint` | `6ad042523a3adfa2…` |
| `environmentFingerprint` | `13a9343f1161362e…` (unchanged since W2-3D) |
| `executionSnapshotId` | `150a3e8c56e658a1…` |
| `checkoutLineEndingPolicy` | `core.autocrlf=false`, passed per command |
| Repository `core.autocrlf` | `true` — unchanged |

---

# Part A — W23E-001

## Finding

Two of three reviewed skills are disabled for every user because the integrity
pin authenticates checkout bytes rather than reviewed content. Availability
defect, fails closed, `P1`, unchanged from W2-3E.

This pass added a third data point that reframes it. **All three pins were taken
in three different byte forms**: `premortem` in CRLF, `agent-loop-engineering` in
LF, `bullshit-detector` in the build script's raw mixed-ending output. Measured
across real checkouts of the same commit:

| Skill | Raw-byte pin verifies under |
| --- | --- |
| `premortem` | `core.autocrlf=true` only |
| `agent-loop-engineering` | `core.autocrlf=false` and `input` only |
| `bullshit-detector` | **no policy at all** |

There is no checkout of this commit under which all three work. That is not a
contract with an implementation bug; it is three artifacts disagreeing about
what the contract is.

**Scope.** Only `.agents/skills` — the reviewed-install root — is hash-verified.
The quarantine and install flow lives under the data root where bytes never
round-trip through git, so raw hashing is sound there. `hermes-skills/prebuilt`
is committed but never verified (`enabled: true, healthy: true` unconditionally).
Seventeen further directories under `.agents/skills` have no registry entry and
are skipped.

## Trust contract

**What the pin should authenticate: the exact reviewed *text* of the artifact, in
UTF-8, independent of which line terminator the checkout wrote.**

Fourteen threat dimensions were decided independently — twelve `MUST_INVALIDATE`,
two `MUST_NOT_INVALIDATE`, none left as a policy decision:

`MUST_NOT_INVALIDATE` — accidental checkout normalisation, and platform checkout
differences. These are the only dimensions where nobody edited anything.

`MUST_INVALIDATE` — everything else, including three that are *representation*
adjacent and were decided by measurement rather than intuition: a trailing
newline, a BOM, and whitespace. Git changes none of them during checkout, so
tolerating them would give up discrimination and fix nothing.

### The historical promise: B, "this exact textual guidance was reviewed"

| Evidence | Reading |
| --- | --- |
| `docs/SKILLS_CATALOG_PROXY.md`: *"re-hashes the reviewed tree before promotion; changed **content** is rejected"* | The stated unit of review is content |
| Same doc: *"Files are written as **UTF-8**"* | Skill files are declared text, not opaque bytes |
| Both failing tests: *"editing the shipped **guidance**"*, *"an **edited** SKILL.md"* | Independently written, same wording |
| `inspectFiles` hashes raw bytes | Faithful to B **where bytes cannot move** — the data root |
| `approvedRoot()` is a **committed** directory | The same discipline transposed to a place where git rewrites bytes. This is the defect |
| Three pins, three byte forms, one registry | **Decisive.** A contract cannot be about bytes if its own instances disagree about which bytes |

## Candidate models

| | A: raw bytes | B: canonical text | B-wide | C: deterministic build | D: `.gitattributes` |
| --- | --- | --- | --- | --- | --- |
| **Security** | 0 false accepts | **0 false accepts** | 0 here, but tolerates BOM and trailing-newline edits | 0 | 0 |
| **Availability** | broken | **fixed** | fixed | partly | not for existing pins |
| **Cross-platform** | no | **yes** | yes | no | only for future pins |
| **False rejects (checkout-reachable)** | 1 | **0** | 0 | 1 | 1 |
| **Migration** | n/a | **all 3 by proof** | same | re-pin needed | re-pin 2 of 3 |
| **Review impact** | integrity failures read as noise | question matches what a reviewer answers | reviewer told a BOM is not a change | neutral | repo-wide policy change |

All nine adversarial mutations were rejected by every model, so security is not
the discriminator — availability and migration are. **B-wide** was rejected on a
measured difference, not a preference: it accepts `LF, no terminal newline` and
`BOM + LF`, which B rejects and no checkout produces. **C** is necessary but not
sufficient. **D** does not fix the existing pins, because the committed blobs are
already LF-normalised.

## Recommended model

**MODEL B — canonical text, line terminators only.**

Applies to files in a hash-verified reviewed set whose declared type is UTF-8
text. Anything else is hashed raw, unchanged — so a future binary artifact keeps
byte-exact verification.

1. Read the bytes.
2. Decode UTF-8 and re-encode; if not byte-identical, **fail verification**.
   Invalid bytes must never become `U+FFFD` and hash as if they were text.
3. Replace `CRLF` → `LF`, then remaining lone `CR` → `LF`.
4. SHA-256 the UTF-8 encoding of the result.

**Affects the hash:** every character including invisible ones; every space and
tab; indentation; the terminal newline; blank-line count; frontmatter including
`name` and `allowed-tools`; line order; the encoding.

**Ignored by the hash:** whether a line ends `CRLF`, `LF` or `CR`. Nothing else.

**Explicitly not done:** no Unicode normalisation, no whitespace collapsing, no
trailing-newline tolerance, no BOM stripping, no case folding, no markdown
parsing.

Why this matches review: a reviewer approves text. They cannot review which byte
a line ends with — no diff view shows it and git rewrites it without asking.
Every other dimension is something a reviewer can see.

Paired, not required: make the `bullshit-detector` generator emit LF, so it stops
producing artifacts whose raw hash no checkout can reproduce.

## Migration — the part that decides whether this is safe

A migration that recomputes hashes from whatever is on disk is a silent
re-review. The rule instead is **derive only by proof**: a canonical pin may be
derived only where some line-terminator rendering of the current content
reproduces the *existing* pin, or where a deterministic generator whose raw
output reproduces the existing pin yields the same canonical text.

| Skill | Route | Result |
| --- | --- | --- |
| `premortem` | CRLF rendering reproduces the pin | `PROVABLE_BY_RENDERING` |
| `agent-loop-engineering` | LF rendering reproduces the pin | `PROVABLE_BY_RENDERING` |
| `bullshit-detector` | generator raw output reproduces the pin, and its canonical form equals the committed content's | `PROVABLE_BY_GENERATOR` |

**Zero require human re-review. Zero blind re-pins.** The derived pin is computed
from bytes the old pin already attests to, and asserts strictly less than its
predecessor, so it cannot approve anything a human did not.

Safety check: an unreviewed line inserted into each artifact before migration —
the rule derives no pin for any of the three and falls through to human review.

## Authorization status

**`SAFE_FOR_SH1_WITH_DEFINED_TRUST_CONTRACT`** — and **not implemented**.

`qa/autonomous/loop-contract.yaml` requires an explicit human gate for
`security_auth_capability_permission_or_sandbox_weakening`, and the README lists
security-gate changes among the actions that stop for approval. Narrowing what an
integrity hash distinguishes is such a change however well justified, and the
gate policy does not treat a completed trust-contract selection as authorisation.

W23E-001 is **not fixed**. The five tests are still red and should be.

To proceed:

```text
APPROVE LOOP ACTION: adopt canonical-text pin (Model B) + derive the three pins by proof / dashboard/src/lib/hermes/skills.ts + .agents/skills/registry.json + scripts/build-bullshit-detector-skill.mjs / revert the commit; the pins are derivable again from the same proof
```

---

# Part B — Source Assertion Policy

## Policy

`qa/autonomous/SOURCE_ASSERTION_POLICY.md`. Six classes — `S1` structural
security, `S2` architectural, `S3` reviewed artifact, `B1` behaviour, `I1`
implementation detail, `P1` prose — with a five-question decision walk.

It deliberately does **not** say runtime tests are always better. Three rules do
most of the work:

- **Never satisfy an assertion by adding dead code.** If the only way to pass is
  to add a class, attribute or identifier nothing consumes, the assertion is
  wrong.
- **Parse, do not slice.** A text window between two markers silently widens as
  the file grows.
- **Undetermined beats guessed.**

The review helper reports; it is wired into no gate. A linter confident enough to
block a legitimate `S1` assertion would cost more than the coupling it removes.

## Held-case adjudication — 33 cases, one policy

| Verdict | Count |
| --- | ---: |
| `REPLACE_DESIGNED_NOT_APPLIED` | 20 |
| `KEEP_BOTH` | 4 |
| `REPLACE_APPLIED` | 4 |
| `KEEP_SOURCE_ASSERTION` | 3 |
| `REMOVE_AS_REDUNDANT` | 1 |
| `UNDETERMINED` | 1 |

Seven test corrections were applied.

## UI_SHAPE

The premise that `UI_SHAPE` means implementation detail is wrong, and the
adjudication says so: **two of eighteen are kept as structural contracts.**

- `dashboard-agent-terminal-ui :: a fully open terminal stops the page behind it
  from scrolling` — the assertion protects `removeEventListener` on unmount. The
  failure mode is *absence*, and a leak is invisible to a behavioural test until
  it has already accumulated. `S2`, kept.
- `hermes-live-routing :: the unified slash hub embeds Skills.sh discovery and
  the reviewed promotion flow` — search → detail → install → promote. Dropping a
  stage would let an install skip review. `S1/S2`, kept; the one improvement is
  to split the ordered regex into four so a failure names the missing stage.

One is removed as redundant: `socials-manager :: the inline Socials Manager card
restores every durable post` asserts a **TypeScript type signature** by regex.
The compiler already enforces it, more strictly and at every call site.

One is left `UNDETERMINED`: `hermes-terminal-artifacts` — the test title is about
UI placement and the failing pattern is an event name, so they are about
different things and guessing would be worse than waiting.

The remaining fourteen stand for behaviour observable in the DOM or in a pure
function, and carry designs.

## Executable replacements

Seven of the eight `ROUTE_QUERY`/`PROJECTION` cases are behavioural and adopt the
executable replacement. **One is retained for a documented structural reason**:
`quartz-ai-parity :: session transcript presentation is shared, not duplicated`.
No-duplication is `S2` — a second implementation can be behaviourally identical
on every sampled input and still be the defect — so decision rule 2 stops the
walk before rule 3.

The three `ROUTE_QUERY` cases became `KEEP_BOTH`: the literal assertion is
replaced by a wiring assertion that the surface reaches
`loadHermesSessionSummaries` — which dead code cannot satisfy, unlike the URL
literal — and one new executable test runs the real client across valid surfaces
and crafted values, asserting the path, an exact round-trip, exactly one query
parameter, and `no-store`.

## ROOT-5

Applied. The old assertion pinned the identifier `vlmFigureCount`; the
replacement pins the derivation (`figureCount = vlm.figureCount`) and the
destination (the field reaches the persisted payload). A pure rename now passes —
which is the behaviour the old assertion lacked — while a defaulted or discarded
count fails.

## Test corrections applied

| Test | Correction |
| --- | --- |
| `background-hermes-chat` | URL literal → shared-client wiring |
| `garden-agent-chat-ui` | URL literal → shared-client wiring |
| `hermes-live-routing` | URL literal → shared-client wiring; `setSessionId(restored.id)` → restore-guard + loaded-object setter |
| `hermes-live-routing` | **new** executable surface round-trip test |
| `vlm-ocr-figures` | identifier → derivation + destination |
| `vimax-chat-ownership` | legacy-only fixture → the canonical store the Garden actually uses |
| `visual-decision-policy` ×2 | helper authors `learnerAction` and projects `decision.interaction` with the product's own function |

No product file was touched.

## Prediction vs actual flips

Eight predicted, **seven matched**, zero unexpected flips across the 22
baselined files. The one miss is the most useful output of the pass. **`hermes-live-routing
:: terminal session hook restores…` did not flip.** Correcting the assertion the
inventory recorded left the test red, because it carries *at least three
independent* failing source-shape assertions:

1. the URL literal — corrected;
2. `setSessionId(restored.id)` — corrected this pass, newly discovered; the
   restore guard proves the two ids are the same session, so which variable is
   passed is a naming choice;
3. `session.send(text, { model, reasoningEffort })` — still failing; the call was
   reformatted across lines in `dashboard-agent-terminal.tsx`, a file the
   developer is actively editing.

**The held inventory records one failing pattern per test, not every failing
assertion in it.** The 33 are *tests*, not assertions, so the true remaining work
is larger than 33. A per-assertion inventory should precede the next application
pass. My prediction was wrong because I derived it from the inventory instead of
from the test.

## Dashboard result

`npm run test:dashboard`: **5151 tests, 5085 passing, 45 failing.**

Those counts are context, not evidence — they are not comparable to the 55/60
recorded in W2-3C, because the developer tree has moved and tests have been
added since. The evidence is the per-identity comparison against this pass's own
pre-edit baseline: **7 of 8 predictions matched, 0 unexpected flips.** There was no same-snapshot full-suite baseline before the
edits, so the no-flip claim outside those files rests on confinement — six test
files changed, zero product files — rather than on measurement. That is stated
rather than papered over.

## Remaining unresolved contracts

19 rows were `UNRESOLVED_CONTRACT` entering this pass. The policy classifies the
33 held cases but only 7 corrections are applied, so most remain red pending
their replacements. Plus: `PROSE_COPY` (7), `ROOT-6` residuals (3), `ROOT-8` (13),
and the five `SKILL_INTEGRITY_PIN` tests awaiting the W23E-001 decision.

## Integrity

| Check | Result |
| --- | --- |
| Assertions weakened | **0** — every replacement carries a counterexample proof |
| Product changes outside an approved repair | **0** |
| Repository git config changed | **no** — `core.autocrlf` still `true` |
| Global git config changed | no |
| `.gitattributes` changed | **no** — none added, none exists |
| Reviewed hashes changed | **no** |
| Reviewed artifacts regenerated | **no** |
| Developer state touched | no — the six edited files were already LF, so no byte-form change was introduced |
| Vendored roots modified | no |
| Secret findings | 0 |
| Commit / stash / reset | none |
| Counterexample proofs | **16/16 caught** |
| Test files changed | 6, all under `dashboard/tests` |

## Success criteria

1. Trust contract explicitly defined — **yes**, Model B with exact semantics.
2. No trust-boundary change smuggled in — **yes**, nothing implemented; the gate
   stands and the approval string is provided.
3. Candidates tested against representation-only and meaningful-content
   mutations — **yes**, 8 representations × 9 adversarial mutations × 5 models,
   plus three real checkout policies.
4. Policy explicit — **yes**, `SOURCE_ASSERTION_POLICY.md`.
5. All held cases classified under one policy — **yes**, 33/33.
6. `UI_SHAPE` adjudicated — **yes**, 18/18, two kept structural.
7. Proven executable replacements adopted or retained with a reason — **yes**,
   7 adopted, 1 retained as `S2` with a documented reason.
8. Corrections have counterexample proof — **yes**, 16/16.
9. No assertion weakened to lower failures — **yes**; one correction was applied
   to a test that is still red, which is the opposite of that failure mode.
10. No repository/global git config modified — **yes**.
11. Reviewed artifacts/hashes not silently regenerated — **yes**.
12. No user/developer state mutated — **yes**.
13. Evidence snapshot-bound and identity-based — **yes**.

## Next action

1. **Decide W23E-001.** The approval string is above. Nothing else in Week 2
   blocks real users.
2. Build a **per-assertion** inventory of the held set, now that the per-test one
   is known to undercount.
3. Apply the 20 designed replacements in one reviewed change.
4. `PROSE_COPY` (7) — the `P1` determination.
5. `ROOT-6` residuals (3).
6. `ROOT-8` (13) — one frozen snapshot, both arms.
7. Final dashboard rerun, then close W2-3.

Then ingestion. Not before, and not Week 3.
