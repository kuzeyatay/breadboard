# Telecom M1 planning repair

The audited map confused thirteen syllabus obligations with thirteen lesson pages, omitted the selected exercise sheets from its question registry, approved atmospheric absorption from a heading, and dropped recovered radio-over-fiber pages before lesson planning.

Implemented:

- Scope planning now states inclusion, exclusion, and actual learner background without fixing lesson boundaries or word estimates. The existing workload gate routes overloaded contracts through full model repair; deliberately unused figures no longer count as taught artifacts.
- A bounded page selector considers every teachable syllabus item, including positive coverage verdicts, and explicitly classifies every selected source for practice. Complete canonical source pages are hydrated separately from navigation metadata.
- Source Map verifies quotations against the actual teaching pages and accounts for each selected practice page through registered questions or named omissions. Figure and syllabus references are no longer the only path for discovering exercises. Question prompts must occur on their assigned pages, including continuations.
- Missing explanations or continuations trigger one additional page-selection healing pass. Schema repairs remain bounded. Transport failures and cancellation propagate rather than consuming an evidence retry.
- Verified teaching anchors must reach lessons mapped to their syllabus item. The same bindings are checked again at map confirmation and generation. Old maps without this evidence contract require replanning.
- Hyphenated question identifiers such as 5-75 retain their identity. Dotted question ranges remain supported.

Validation:

- 120 focused tests passed across planning evidence, questions, workload contracts, spine projection, coverage recovery, pedagogy, and spine healing.
- 24 selected syllabus/selection/API tests passed.
- Targeted TypeScript checking passed, and the touched changes passed whitespace checks.
- Replayed the audit against all 4,524 canonical Telecom source pages. The workload gate rejects five old lesson contracts; the evidence gate detects the missing atmospheric-absorption page and rejects the old unverified map. The actual Molisch page 107 and the instruction sheet's questions 5-67 through 5-75 are available to the selector.
- The broader syllabus test file also has an unrelated existing UI assertion expecting three popovers where the current workspace has four. That UI was not changed for this repair.

Live state at 18:12 UTC:

- The previous run was already cancelled before repair, and its proposed map and generation version had been removed by cancellation cleanup.
- A pending compensating publication initially blocked replanning. The existing recovery worker finished; no lease or database safety check was bypassed.
- Submitted a planning-only replacement through the canonical Runtime V2 operation boundary, retaining the original source selection, M1 scope, source-only mode, and gpt-6-luna model. The worker runs from this repository's source files.
- Runtime job: `job_d5b2c2458fd552bbd48cab7f69c1db2d5b3c8470cdc7b29bb45e72bdce5d2bcf`.
- Learn job: `learn_job_muef2bq0_7huimjz`.
- It is checking source figures. Automatic map confirmation is disabled. The replacement map has not yet been produced or reviewed; these results validate the implementation and the regression cases, not the quality of a completed new course.

Local audit replay: `.runtime/telecom-map-audit-20260923/regression-replay.json`.
