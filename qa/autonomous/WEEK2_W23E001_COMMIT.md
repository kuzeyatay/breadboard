# Breadboard W2-3H — W23E-001 Commit

## Decision

**COMMITTED_AND_REVERIFIED**

`3163069551fbb574db5ea79e49bae323fbbe13f2`, parent `5d7330a1c604…`, on `master`.

## Identity reconfirmed immediately before staging

HEAD had moved — the developer committed `5d7330a1c` after the landing — so this
mattered rather than being ceremony:

- landed bytes still byte-identical to the verified candidate, all four files;
- the developer's new commit touched **none** of the footprint, so the change
  sits cleanly on top with no rebase and no conflict resolution;
- the diff contains **no W23F-002 work** — verified positively by grepping for
  `requiresReviewedIntegrityPin` and `provenance` (zero hits) and by confirming
  the `pinnedHashes.length === 0` fail-open is **still present** at line 429;
- no unrelated assertion work, no regenerated artifacts, no re-pins;
- git configuration unchanged.

## Staged from the authoritative footprint

Not from `git diff`, not from the whole snapshot, and **not** from the old
receipt's `files_changed` — that field listed 150+ paths because it recorded the
entire snapshot-worktree diff. The four staged paths are the finalized
capability's authorised writes plus the two verified factcheck updates:

```
.agents/skills/registry.json
dashboard/src/lib/hermes/skills.ts
dashboard/tests/factcheck-integration.test.mjs
dashboard/tests/reviewed-skill-pin-canonicalisation.test.mjs
```

`git diff --cached --name-only` filtered against that list returned **nothing
unrelated**. 4 files, 304 insertions, 25 deletions.

## Post-commit verification

25/25 across the regression suite, `factcheck-integration` and
`premortem-integration`. Original reproduction replayed from committed state: all
three skills healthy, both slash invocations accepted, `quartz_ai` exposure
unchanged, defect no longer reproduces.

**The durability check that matters most:** the committed state was checked out
fresh under `core.autocrlf` **true**, **false** and **input**, and all three
skills verify under every one — with byte forms genuinely differing across arms.
Git normalised the new test file to LF on commit and will hand it back as CRLF on
a Windows checkout; under the canonical contract that no longer changes anything,
which is precisely the point.

## Integrity

| Check | Result |
| --- | --- |
| Commit contains only W23E-001 | **yes** — 4 files, nothing unrelated |
| W23F-002 included | **no** — verified by absence of its symbols and presence of the untouched fail-open |
| Push / PR / merge | false / false / false |
| Assertions weakened | 0 |
| Dead code added | none |
| Blind re-pins | 0 |
| Reviewed artifacts regenerated | no |
| Repo / global git config changed | no / no |
| `.gitattributes` changed | no |
| Vendored roots modified | no |
| `node_modules` intact | yes |
| Developer unrelated work touched | no — their in-flight changes remain unstaged |
| Secret findings | 0 |

Committed on `master` rather than a branch: the developer works directly on
`master` and committed there minutes earlier, and the instruction was one focused
commit with no push.
