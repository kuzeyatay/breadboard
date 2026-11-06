# EM1 regeneration handoff for Claude

Written 2026-09-27T23:51:26.980Z.

The requested regeneration of all three EM1 Introduction notes is finished. Each replacement was generated and reviewed by Breadboard through an authenticated real EM1 Garden chat, using gpt-6-luna, then applied through Breadboard's normal proposal API. Codex read the generated text and repairs, checked mathematics and preserved references, and verified each canonical file byte-for-byte against its accepted review. The final Markdown was not manually authored or copied into Quartz by Codex.

## Published pages

The existing pages in EM1 → Introduction were replaced; their paths and frontmatter were preserved. The folder index was not changed.

### Fields, vectors, and Cartesian coordinates

- File: C:/Users/20252082/AppData/Roaming/breadboard-desktop/Data/quartz/content/electromagnetism-1/introduction/fields-vectors-and-cartesian-coordinates-1790174177632.md
- Real Garden run: 91c75e5e-16e4-41a6-83ab-57ce285f0520
- Applied proposal: 18
- Content repairs in the final accepted run: 0
- SHA-256: 017d8c468b440856964ac2a40b79329ff70fa1981930017c30b375185d70c67b

### Dot products, cross products, and the geometry of vectors

- File: C:/Users/20252082/AppData/Roaming/breadboard-desktop/Data/quartz/content/electromagnetism-1/introduction/dot-products-cross-products-and-the-geometry-of-vectors-1790256290456.md
- Real Garden run: ec2e5451-9224-431c-84b2-e53a139a1737
- Applied proposal: 19
- Content repairs in the final accepted run: 1
- SHA-256: b8e3c37e8031a6b9e4dda2c3efdfcdcc54b6ee3233d374a99aedd0b3f6b582b2

### Geometry, curved coordinates, and integration

- File: C:/Users/20252082/AppData/Roaming/breadboard-desktop/Data/quartz/content/electromagnetism-1/introduction/geometry-curved-coordinates-and-integration-1790189648258.md
- Real Garden run: 04e30b4b-f868-46c1-a01c-88a01d439eee
- Applied proposal: 20
- Content repairs in the final accepted run: 1
- SHA-256: 2896110b9134b71f160137f313eaa99a58f2039b5261b1eed35cf212c3b0bb07


## Code and regression work

The shared Learn/Garden/chat teaching pipeline now uses teaching plan v4 and review v11. It derives educational intent and evidence on the server, plans prerequisite order separately from source coverage, reviews the actual resulting text, preserves exact-save/translation behavior, and keys acceptance to exact content, plan, evidence, model and review version. Earlier reading requires actual matching prior-lesson text, not merely a retrieved concept page. Full-page review follows each repair, with at most three content repairs and failed drafts retained.

Regeneration exposed and fixed additional concrete problems:

- Long Garden revisions support complete-body read receipts and retained generated draft references. Ownership, exact target page, complete current body, scope and normal teaching review are checked; omitting optional lesson metadata cannot skip review. Existing text-based tool calls remain compatible.
- Internal repairs now prefer exact nonoverlapping passage edits applied to the current candidate. Untouched examples, formulas and citations stay byte-identical. Unknown/stale/overlapping edits and edits outside the authorized scope are rejected. The entire resulting page is reviewed again; legacy full-Markdown repair responses remain compatible and subject to review.
- Review evidence can use server-assigned passage IDs/ranges, including strictly parsed textual locators, resolved to exact quotations. Stale IDs and reversed ranges fail closed. Prior-lesson evidence cannot borrow draft references.
- Reviewer and repair instructions cover added advanced asides, fallible proposed numeric corrections, protected practice questions, complete source coverage, and avoiding false-calculation/self-correction detours.
- Relevant earlier fixes include repair cancellation/timeouts, longer bounded write-tool deadlines, no silent truncation of long revisions, post-rewrite acceptance invalidation, and exact short source-heading retrieval.
- A subsequent delivery-classification fix distinguishes editorial failure reports from teaching even when they mention formula defects, and classifies reports over 4,000 characters instead of automatically expanding them. Eleven runtime tests and four live gpt-6-luna classifier cases passed, including the exact failed EM1 report. The app was later found already stopped with no Breadboard services running. It was rebuilt and launched with this fix; the production build and TypeScript check passed (delivery-fix-build-and-app.log). The v11 lesson-review and passage-repair changes were also built and used for regeneration.
- A further concrete planner bug interpreted the mathematical phrase "forward/inverse general components" as an external forwarding action. task-plan.ts now excludes adjacent mathematical direction pairs while preserving approval for actual forwarding commands, including a path named /inverse. The planner and capability-broker suites passed all 79 tests, and diff checking passed. This last small classifier fix is in source and has not been loaded into the running production bundle; the final chat request uses equivalent unambiguous wording and explicitly asks to revise the Garden page, so it works under the existing broker rules. Rebuild normally to load the classifier fix. Earlier attempts also mistakenly used the runtime approval endpoint for a preflight confirmation; its success response did not re-broker the static pending plan. No global approval or autonomy settings were changed.

Key files include dashboard/src/lib/hermes/{garden-tools,teaching-runtime,garden-reader}.ts; dashboard/src/lib/{teaching-plan,teaching-review-contract,teaching-draft-evidence,teaching-repair-edits,learn-teaching-context,learn-lesson-terms,learn-teaching-healing}.ts; and hermes-agent/plugins/breadboard/{__init__.py,garden_revision_reads.py}.

Validation: 86 focused JavaScript tests passed (v11-tests.txt), 5 focused Python read-receipt tests passed through scripts/run_tests.sh using an isolated temporary directory (draft-ref-python-tests-fixed.txt), and the production build plus TypeScript check passed (v11-build-and-app.log). The first Python invocation hit an existing inaccessible global pytest temp directory; the isolated rerun passed. The live final run exercises the real retained-draft and complete-page review path. Original references and figures, one-H1 formatting, protected frontmatter and mathematical rendering were checked. Numerical wedge, vector-norm and shell values were checked independently.

## Audit and limits

All regeneration requests, raw SSE events, retained drafts, exact review responses, proposal payloads, original backups and verified publication receipts are under:

C:/Users/20252082/Documents/Codex/2026-09-26/i/work/em1-real-chat

The user also requested reusable versions of the successful prompts. Two were saved through Breadboard's authenticated Prompts API and verified both by exact content readback and in the Prompts command catalog, in category Study: user-4, "Rebuild a lesson from first principles", and user-5, "Rebuild a lesson in a sequence". They use the selected lesson/Garden, sources and demonstrated background instead of hard-coded EM1 paths. Their content and receipts are in reusable-teaching-prompts.json and verified-reusable-teaching-prompts.json in the audit folder. Existing prompts were left intact.

Original backups are in its before/ folder. The rejected run 134e61cd-8d5c-43d1-b69d-b684c456b59f exposed the full-rewrite repair regression; its third repair dropped previously correct examples and was never published. Its better retained draft was used for the final correction.

Runtime reliability also delayed regeneration independently of content review. Run a1119e6a-e161-441b-9213-88776bf21398 retained its first review but was interrupted when the native runtime exited with code 70 after a background-task-node worker failed bounded cleanup; the desktop automatically recovered. This is recorded around 2026-09-27T19:27–19:33Z in Data/logs/desktop.log. Later retries failed with upstream HTTP 500/read-timeout and SSL connection errors. A narrowed reference-reading request reached the proposal tool, but the model mistyped the retained draft ID; the tool safely rejected it. Its final status report remained a status report, exercising the delivery-classifier fix. After a local authentication request then timed out, the app was restarted around 20:18–20:23Z; the Learn job had already independently failed at 20:10:20Z and no Garden run was active. The worker-cleanup defect and upstream connection problems were not fixed as part of the teaching changes; they remain separate reliability issues for follow-up. No rejected replacement from those runs was published.

Four earlier bounded before/after evaluation artifacts exist at C:/Users/20252082/Documents/Codex/2026-09-26/i/work/teaching-evaluation: EM1 synthesis, lesson revision, nonmathematical explanation, and Learn sequence. They used gpt-6-astra on September 26 with an earlier plan/review revision; their blind comparisons favored the planned/reviewed outputs, with qualifications recorded in each file. These are historical evidence, not a fresh four-case benchmark of v11. The EM1 publication work does not establish success of an unrelated Learn job.

Latest Learn job observed at handoff: learn_job_mukgzblc_7xobqnd; status planning; updated 2026-09-27T23:51:14.785Z. Recorded step: Left out S20.P929.T1: its crop did not match the page (The crop shows 802.11ax frame-format diagrams. The described access-category parameter table is not visible on the page.).. During the September 27 evening continuation, no Learn job was cancelled or explicitly restarted. At the first launch the app was already stopped; before the later authorized app restart, the newer Learn job had independently failed while reading the syllabus. Earlier restarts in this longer task did interrupt other Learn jobs, as previously disclosed. Do not infer that the unrelated Learn job completed from the EM1 note regeneration.

Changes are uncommitted in the existing, heavily modified checkout. No commit or PR was created. Preserve unrelated changes. Breadboard remains running for the user.
