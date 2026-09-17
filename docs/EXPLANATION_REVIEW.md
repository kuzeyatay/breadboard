# Explanation coverage review

Hermes answers in Garden Chat (including inline questions), Terminal and the
Quartz assistant pass through an explanation review before the stable answer
is emitted and persisted. This is independent of the ChatMock Council path,
which bypasses tool-bearing requests.

Before generation, Garden Chat and canonical Terminal/Quartz turns build a
scoped explanation packet with recent conversation (14,000 characters for repairs;
the existing 120,000-character allowance for broader questions), the
selected passage and parent response (up to 24,000 characters), and established
conversation constraints (4,000 characters). The current Garden is searched
using the selected subject, rather than the surrounding selection instructions.
Retrieved passages are supplied to the answering model and reused in review.
Prior assistant text is explicitly separated from evidence. A clarification
gets a causal continuity contract: establish the initial conditions, justify
each transition, and never promote an assumed condition to an observed event.

For explanation repairs, memory projection omits duplicated history, completed
action lists and the inferred profile; confirmed durable preferences and scope
policy remain. Unrelated feature guides, generic task scaffolding and broad
answer-depth instructions are omitted, without changing tool permissions.
Conversation compaction no longer removes open questions merely because an
assistant answer contains their keywords, and admits explanation requests that
lack question marks. This is bounded unresolved history, not a claim that every
retained question is still confusing the user.

The admission check reads the user's request, excluding marked attachments and
quoted material. Informal objections such as "what adjustment", "what do you
mean", and "I still don't understand" are eligible. A model then decides whether
a causal explanation is needed and derives one to six concrete mechanism requirements from the question and
its context, without seeing the draft. Retrieved source passages are kept
separate from prior model prose, and source-grounded requirements must cite
exact passages from that material. A separate call compares the draft to
every requirement. Covered requirements need one to four exact answer passages,
each checked as a contiguous substring; bold delimiters and whitespace wrapping
may be normalized for lookup, then mapped back to the exact original span.
Words, signs, numbers and intervening content cannot be dropped. Omissions
need a concrete reason and the misconception they would cause. One optional
repair call preserves existing citations and supplies exact revised-answer
quotes for every requirement. A final model call checks the revision against
sources and general knowledge without seeing the generated checklist. It can
reject new errors or lost qualifications; a rejected repair retains the draft.
There is no recursive revision loop.

The default is enabled. `ENABLE_EXPLANATION_REVIEW=0` disables the review.
It uses the turn's recorded selected model, low reasoning effort, the existing
ChatMock endpoint and credentials, and no tools or Council fan-out. The whole
model review has a 90-second deadline and at most four model calls (output caps:
2,048 / 4,096 / 8,192 / 4,096 tokens). Simple non-explanation turns incur no call;
ambiguous candidates can incur one applicability call. Artifact-producing and
delegated-result turns keep their existing completion contracts.

For older runs without a pre-generation packet, before planning the current Garden is searched for relevant passages using
existing lexical and graph retrieval, without another model call. This gives
the critic source material beyond the earlier model's framing. Other Gardens
are not added by this pass. The reviewer can reject unnecessary requirements
from the planner, so a complete introductory explanation need not expand into
a survey.

Review input is bounded. The complete draft is retained; oversized drafts are
left unreviewed instead of checking a truncated answer. Source context can be
excerpted and is explicitly marked as such. Uncertain source-dependent gaps
are recorded as needing evidence, not filled by guessing. This pass does not
search the web; it uses the current Garden and the normal agent's evidence.

Timeouts, malformed JSON, incomplete coverage, invalid quotes, changed source
references and unsuccessful repairs retain the original answer and record an
unavailable review. Stops cancel the review and cannot complete the turn.
Receipts and accepted answers are saved together on the durable run before
publication, so reconnects can reuse them. Usage is included in the answer's
turn total; absent provider usage is marked partial. The evidence panel reports
review outcomes separately from factual verification. Invalid results record the
failed stage and a bounded diagnostic reason; unrelated retrieved passages do
not force fabricated source support for a general-knowledge requirement. Canonical conversation
memory carries the published answer into subsequent prompts.

This is a model-based omission check, not a correctness guarantee. The same
model can miss a mechanism twice, or suggest an unnecessary requirement. Unit
tests exercise routing, bounded calls, acceptance, repair, cancellation and
failure handling. A fixture evaluation should compare omission detection,
unnecessary edits, latency and total tokens against the same model answering
alone before claiming a measured quality improvement.

Run the live fixtures explicitly from `dashboard` with
`node --experimental-strip-types scripts/evaluate-explanation-review.mjs gpt-5.6-sol`
using the configured ChatMock endpoint. These are smoke checks, not a benchmark.
Inspect answer content against the recorded criteria, not merely the returned
review status. Earlier trials showed that a same-model review can miss the
target omission, request extra introductory detail, or introduce a new error
while repairing a gap. Source-linked planning and the final factual check
address those observed failure paths, without eliminating correlated mistakes.

The final local GPT-5.6 Sol battery fixture included the battery's initial
field, local electron response, electromagnetic propagation, and the combined
battery/surface-charge feedback. It passed the final check in four calls,
59.4 seconds and 44,008 additional tokens. A separate live regression replayed
an earlier repair that reversed the field direction; the new final verifier
rejected it and retained the original draft. These single-case results are
recorded under `dashboard/artifacts/explanation-review/`; they do not establish
an overall accuracy improvement or typical latency.

Implementation: `dashboard/src/lib/hermes/explanation-review.ts`,
`explanation-review-provider.ts`, `explanation-review-runtime.ts`, and
`explanation-turn.ts`. `scripts/evaluate-explanation-repair.mjs` replays an
explicit fixture through the generation contract and review without writing to
the original conversation; its single-case output is not a controlled benchmark.

The September 13 explanation-repair replay uses the actual "what adjustment"
follow-up and selected parent response. At low reasoning effort, generation
took 21.7 seconds and the four-call review took 62.2 seconds. The accepted repair
added the initiating step and retained consistent signed-charge accounting.
Earlier attempts exposed an incorrect sign in a draft and a quotation match
failure caused by bold markup; regression tests cover both failure paths.
The original turn used maximum effort, and this isolated replay omits the live
tool configuration and inferred memory, so its timings are not a speed comparison.
The final regression set passed 162 tests, scoped TypeScript checking, and an
isolated production build. Replay receipts are under
`dashboard/artifacts/explanation-repair/`.
