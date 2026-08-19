# Breadboard W2-3G — W23E-001 Landing

## Decision

**W23E-001 LANDED_AND_REVERIFIED** — landed in the working tree, **not committed**.

## Candidate identity

Receipt `VERIFIED_REPAIR`, capability `be228038-243c-495f-a057-69d7aaac2c04`
finalized, `unauthorisedChanges: []`, assertion-integrity zero rejections,
isolation verified, secret scan clean, worktree head matching the receipt
revision. Identity intact.

**The receipt overstated its own footprint.** `files_changed` listed 150+ paths
because it recorded the whole snapshot-worktree diff — the same snapshot
blindness as W23F-H1, in a third place. The authoritative footprint is the
capability's three authorised writes, and that is what was landed.

## Target compatibility

Target head matched the candidate revision. None of the three footprint files
carried uncommitted developer edits, so no merge and no conflict resolution were
needed. **The landed bytes are byte-identical to the verified bytes** — which
matters, because a conflict-resolved patch would not have been covered by the
receipt.

## Landed

| File | |
| --- | --- |
| `dashboard/src/lib/hermes/skills.ts` | canonical text hashing, `text-v1` scheme |
| `.agents/skills/registry.json` | three proof-derived pins |
| `dashboard/tests/reviewed-skill-pin-canonicalisation.test.mjs` | new regression |

## Reverified after landing

Not on the old receipt: everything was re-run against the landed tree.

Regression suite 8/8. All three skills `enabled=true, healthy=true`,
dispatch allowed. `/premortem` and `/bullshit-detector` both accepted. `quartz_ai`
exposure unchanged (empty). Verifies under `core.autocrlf` true, false and input.
Adversarial content mutations all rejected; representation-only renderings all
accepted. Invalid UTF-8 fails closed. Six line-ending shapes, one identity. All
four wrong verifiers distinguished.

## Two more tests moved with the contract

`factcheck-integration` carried the only two assertions that encoded the **old**
raw-byte contract — a byte-exact rebuild comparison and a raw-hash pin
assertion. Under an authorized contract change these had to move with it. Both
now compare canonically and still fail on any content difference; neither was
weakened.

## Flips

Five predicted, five landed — the five W23E-001 tests.

**Two unexpected flips**, both in `generated-visual-spatial-scene.test.mjs`,
moving in opposite directions. Re-running that file twice with no change between
gave pass, then fail: **FLAKY**, browser-gated, and unrelated to a change that
touched only skill hashing. Reported rather than absorbed into a lower red count.

21 further tests are new — the developer added them since the previous run.

## Dashboard

47 failing before, **42** after. Counts are context; the per-identity comparison
is the evidence.

## Not committed

`loop-contract.yaml` lists `commit_push_open_pr_merge_or_schedule` among the
actions requiring the explicit `APPROVE LOOP ACTION` string, which was not
supplied. The repair is landed and reverified in the working tree; committing is
the one remaining gated step.

```text
APPROVE LOOP ACTION: commit the landed W23E-001 repair / dashboard/src/lib/hermes/skills.ts + .agents/skills/registry.json + dashboard/tests/reviewed-skill-pin-canonicalisation.test.mjs + dashboard/tests/factcheck-integration.test.mjs / git revert the commit
```

## Integrity

| Check | Result |
| --- | --- |
| Commit hash | **none — not committed** |
| Files landed | 3 (+2 contract-encoding tests) |
| Unrelated files in the change | 0 |
| Product changes outside authorization | 0 |
| Reviewed artifacts regenerated | no |
| Blind re-pins | 0 |
| Assertions weakened | 0 |
| Unexpected test flips | 2, both proven FLAKY |
| Repo git config changed | no |
| Global git config changed | no |
| `.gitattributes` changed | no |
| Vendored roots modified | no (92) |
| `node_modules` intact | yes (649) |
| Developer unrelated work touched | no |
| Secret findings | 0 |
| Push / PR / merge | false / false / false |
