# Breadboard W2-3G — Assertion Corrections

## Decision

**ASSERTION_CORRECTIONS_STILL_OPEN**

Zero assertion corrections applied. That is a scope statement, not a discovery:
the pass budget went to landing and reverifying W23E-001 and to settling
W23F-002, and applying a *subset* of a multi-assertion test would repeat exactly
the prediction error this workstream exists to correct.

## Current state, re-measured after landing

| | |
| --- | ---: |
| Assertions extracted | 1723 |
| Failing assertions | **50** |
| Tests with at least one failing assertion | 27 |
| Tests with **more than one** | **11** |
| Worst single test | 10 failing assertions |

**No stale evidence.** The refreshed inventory measures the same 50 failing
assertions as the frozen V2 adjudication, so no developer edit invalidated it.

## What did change, and why it is not this pass

`factcheck-integration` gained two corrections — the byte-exact rebuild
comparison and the raw-hash pin assertion. Those encoded the **old** trust
contract and had to move with the authorized W23E-001 change, so they are Part A
scope. Both now compare canonically and still fail on any content difference;
neither was weakened.

## Retained structural assertions

Unchanged, per policy: the `removeEventListener` cleanup guards, and the
four-stage promotion/review flow. Neither is replaced merely because a runtime
test would be more fashionable — in both, absence *is* the failure mode.

## Remaining contract map

Every remaining failing test lists its remaining failing assertion ids in
`remaining-contract-map.json`, each with its classification, blocking reason and
required next decision. No sibling failure is hidden behind a resolved one, and
`eligibleForPredictedFlip` is `false` for all 27 because none has been resolved.

## Part D — selftest coverage gap, fixed

The contract was established from the script's own docstring, which promised
`qa/harness-selftest/*.test.mjs` while the code named four files by hand. So the
intent is **B, the full harness unit suite**, and the list was the defect:
`repair-capability`, `source-snapshot` and `execution-snapshot` — capability
binding and execution identity — never ran under `npm run qa:selftest`.

Replaced with directory discovery, plus a regression that fails if the runner and
the directory ever disagree and proves a newly added file is picked up without
editing any list. Unit tests run by the command went from **68 to 126**.

## Next action

Apply per test group — every failing sibling in a test lands together — starting
with the settled ROUTE_QUERY and PROJECTION replacements, then ROOT-5 and the
three Category-A corrections. Only then PROSE_COPY and the ROOT-6 residuals.
