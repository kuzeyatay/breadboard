# Breadboard W2-3F — Source Assertion Inventory V2

## Decision

**ASSERTION INVENTORY CLOSED**

Every source-oriented assertion in the 26 target files is enumerated,
individually evaluated, and individually classified. No failing assertion is
hidden behind a resolved sibling, and the flip-prediction rule now depends on
all of them.

---

## Why the test-level inventory was insufficient

The previous pass classified 33 **tests**, each carrying the one failing pattern
the triage tooling had recorded. Correcting the recorded pattern in
`hermes-live-routing :: terminal session hook restores…` left the test red,
because it carried three independent failing source assertions. The prediction
was wrong for a structural reason, not a careless one: **the inventory recorded
one assertion per test, and a test flips only when all of its failing assertions
are resolved.**

A test run cannot fix this. `assert` throws on the first failure, so a run
reveals exactly one failing assertion per test however many are broken. The only
way to see the rest is to evaluate each assertion independently — which, for a
source-shape assertion, needs no test run at all: resolve the subject to the file
it reads, then apply the matcher.

That is what the V2 inventory does.

## Totals

| | |
| --- | ---: |
| Target files | 26 |
| Assertions extracted | **1723** |
| Failing assertions | **50** |
| Passing assertions | 883 |
| Unresolved (subject not statically resolvable) | 790 |
| Tests carrying at least one failing assertion | **27** |
| Tests carrying **more than one** | **11** |

The 33-row test-level inventory therefore understated the work by more than a
third, and would have mispredicted 11 of 27 tests.

## Assertions per kind

| Kind | Count |
| --- | ---: |
| `SOURCE_REGEX` | 1058 |
| `RUNTIME_BEHAVIOR` | 488 |
| `SOURCE_ABSENCE` | 158 |
| `SOURCE_LITERAL` | 13 |
| `SOURCE_COUNT` | 6 |

`SOURCE_ABSENCE` is broken out deliberately. A `doesNotMatch` guard names a
pattern that must *not* return; it is a claim about reintroduction, and the first
version of the review helper counted 158 of them as "dead class" violations
before they were labelled separately.

## Tests containing multiple failing source assertions

| Failing | Test |
| ---: | --- |
| 10 | `learn-token-usage :: Learn persistence uses a job-scoped atomic usage table` |
| 4 | `dashboard-agent-terminal-ui :: the brown terminal header toggles fully open and fully closed` |
| 3 | `hermes-live-routing :: garden API dispatches Hermes before the explicitly retained ChatMock backend` |
| 3 | `socials-manager-integration :: the Socials Manager has Breadboard-native account settings in the Agents tab` |
| 2 | `active-run-composer :: the shared composer keeps its controls stable during an active run` |
| 2 | `app-theme :: dark mode uses charcoal paper and Breadboard's pastel utility bridge` |
| 2 | `assistant-message-ui :: completed response duration remains attached to restored assistant messages` |
| 2 | `garden-workspace-external-agents :: the run card shows only the agent name and can close a finished timeline` |
| 2 | `hermes-terminal-artifacts :: Garden UI places Artifacts directly below Videos and Quartz contains no artifact UI` |
| 2 | `socials-manager-integration :: a persistent checkbox per network decides where every post is written` |
| 2 | `socials-manager-integration :: the inline Socials Manager card restores every durable post after chat remounts` |

Several of these were not in the test-level inventory at all — the sweep found
failing source assertions in tests the triage had never flagged.

## Prediction model

A test may be predicted `FAIL -> PASS` only when **every** failing assertion in
it is corrected, intentionally retained and already passing, removed as redundant
with stronger coverage, or otherwise resolved. `replacement-designs.json` groups
designs by test for exactly this reason, and each group states how many
assertions must land together.

## Special cases the policy protects

**`SOURCE_ABSENCE` is not automatically replaced.** The cleanup guard in
`dashboard-agent-terminal-ui` protects `removeEventListener` on unmount: the
failure mode is absence, and a leak is invisible to a short runtime test until it
has already accumulated. Retained as `S2`.

**The four-stage promotion flow stays structural.** search → detail → install →
promote. Dropping a stage would let an install skip review. Retained; the one
improvement is splitting the single ordered regex into four so a failure names
the missing stage.

**Dead code is never the answer.** No assertion may be satisfied by adding a
class, identifier or markup nothing consumes.

**Type contracts.** The `ensureConversation: () => Promise<string>` assertion is
redundant with `tsc`, which enforces it at every call site rather than one. Marked
for removal, not replacement by another regex.

## Review helper precision

Reporting only, wired into no gate.

| Version | dead-class candidates | Precision |
| --- | ---: | --- |
| First | 247 | very low — almost all fixture identifiers |
| Restricted to `assert.` lines | 11 | usable |
| With `doesNotMatch` guards labelled separately | **5** real + 6 labelled guards | usable |

`sliced-window`: 34 candidates, unchanged. No CI gate.

## What is not applied

No test corrections were applied in Part B. The designs are per assertion, but
each still needs its own counterexample executed before application, and applying
a subset of a multi-assertion test would reproduce exactly the mistake this pass
exists to correct. Application is the next pass, and it can now predict flips
correctly.

## Closure criteria

1. All relevant held/failing source assertions enumerated — **yes**, 1723
   extracted, 50 failing.
2. Each classified individually — **yes**, by assertion kind and policy class,
   not by the containing test.
3. Replacements designed individually — **yes**, grouped by test only so the flip
   rule can be applied.
4. No unresolved failing assertion hidden behind a resolved sibling — **yes**;
   the 11 multi-failure tests are the explicit output.
5. Prediction logic uses all failing assertions in the test — **yes**, encoded in
   `replacement-designs.json`.

## Next action

1. Apply the designed replacements per test group, all failing assertions in a
   test together.
2. `PROSE_COPY` (7) — the `P1` determination.
3. `ROOT-6` residuals (3), `ROOT-8` (13).
4. Final dashboard rerun, then close W2-3.
