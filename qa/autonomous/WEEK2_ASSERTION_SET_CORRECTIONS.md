# Breadboard W2-3H — Assertion-Set Corrections

## Decision

**ASSERTION_CORRECTIONS_STILL_OPEN**

Three tests completed atomically. Twenty-four remain.

## What was done, and why only three

The rule was atomicity, not throughput: a test may only be modified when every
currently failing assertion in it has a decided action. Three single-assertion
tests met that bar with proven designs, so those three were completed end to end
rather than twenty half-corrected.

| Test | Action |
| --- | --- |
| `branch-history :: the sessions endpoint restores only the projected active branch` | retarget to the extracted presenter |
| `memory-badge-evidence :: live and restored transcripts both consume authoritative memory evidence` | retarget |
| `quartz-ai-parity :: session transcript presentation is shared, not duplicated` | `KEEP_STRUCTURAL`, retargeted |

All three flipped `FAIL -> PASS`, exactly as predicted, and stayed green across
three consecutive runs with no retries.

## D7 earned its place

Completing `quartz-ai-parity` exposed a **sibling assertion the static extractor
had not counted** — the same relocated presenter, asserted against the Hermes
route rather than the Quartz one. It was inventoried and adjudicated before being
touched, not patched reflexively.

That is a real limit of static extraction, and V3 records it: per-assertion
evaluation is a floor, not a ceiling. A subject the extractor mis-resolves stays
invisible until runtime reaches it.

I also made two mistakes here worth recording: a wrong relative path in the
retarget, and replacing an assertion that was already passing. Both surfaced
immediately because the test was run straight after the change, which is exactly
what the run-immediately step is for.

## Counterexamples

Four changed assertions, four independent challenges, plus a dead-code
sensitivity probe. **5/5 caught.** The honest note on the fifth: the wiring
assertion checks a *named* import, so a bare side-effect import does not satisfy
it — but a genuinely unused named import would. The behavioural half lives in the
same test files, which execute the real projection and the real evidence lookup.

## Prediction vs actual

Three predicted, three landed, derived mechanically from assertion rows rather
than written optimistically.

**Eleven unexpected flips, none attributable to these corrections.** Attributed
by file: `generated-visual-spatial-scene` and `interactive-visualizer` are the
known browser-gated flaky family; `assistant-message-ui`, `learn-timer` and
`ruflo-integration` are developer churn — and one test went **ABSENT**, meaning
it was removed or renamed mid-run. None is in the three files this pass edited.

## Dashboard

5276 tests, 5217 passing, **38 failing** (43 → 40 on the comparable identity
set). Totals are context; the identity comparison is the evidence.

## Remaining

Twenty-four tests, each listing its remaining failing assertion ids in
`remaining-contract-map.json`. Seventeen are single-assertion and completable
next; the rest need their whole set decided together.
