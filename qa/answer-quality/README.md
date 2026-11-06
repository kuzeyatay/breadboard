# Answer quality

A regression suite grown from real complaints.

## Why ratings feed a benchmark instead of a prompt

A thumbs-down is a poor training signal and an excellent test case.

It is a poor training signal because there are very few of them, because they
are confounded — you rate an answer, but the causes are the model, the contracts
that shipped, what retrieval supplied and the shape of the question — and
because feeding them back into a prompt optimises toward whatever happened to
get clicked. Three downvotes on three genuinely wrong answers can distil into
"prefers shorter answers", which then applies to every turn forever, with no
author and nothing to trace it to.

It is an excellent test case because it is a real failure, on a real question,
that a person noticed. Turning it into a scenario costs nothing at answer time,
cannot reward-hack because a human decides what gets promoted, and pays off
every time a contract changes: run the set with the gate off and on and see
whether the thing that was fixed stayed fixed.

## The pipeline

```
thumbs-down (+ reason)
  → answer_signals row with the turn's conditions
  → dashboard/scripts/nominate-answer-quality-scenarios.mjs
  → qa/answer-quality/candidates.json      (mined, unreviewed)
  → a human edit                            ← the step that is not automated
  → qa/answer-quality/scenarios.json        (the suite)
  → scripts/evaluate-answer-quality.mjs
```

Promotion is deliberately manual for two reasons. A scenario carries a question
and an answer verbatim out of a private conversation into a file that gets read,
diffed and shared, and that should be a decision rather than a side effect. And
a mined candidate's properties are generated from the reason code: for `wrong`,
`too_long` and `missed_point` the generated properties hold for any subject, but
for `style` there is no subject-independent rule — the rating said the register
was wrong without saying what it should have been, so those candidates arrive
carrying `propertiesNeedReview` and a `REVIEW:` placeholder that a person has to
replace before the scenario asserts anything at all.

## Running it

```
node --experimental-strip-types scripts/evaluate-answer-quality.mjs --model gpt-6-sol --reasoning-effort max
node --experimental-strip-types scripts/evaluate-answer-quality.mjs --model gpt-6-sol --reasoning-effort max --scenario one-fact-question-gets-the-fact
node --experimental-strip-types scripts/evaluate-answer-quality.mjs --model gpt-6-sol --reasoning-effort max --reason too_long --json report.json
```

Opt-in, like `evaluate-evidence-calibration.mjs`, because it costs provider calls
and because a grader model is not a deterministic oracle — it belongs in a
reviewed run, not the per-commit suite.

Use the model and settings implicated in the report. A weaker model can be a
useful additional stress test, but cannot establish that the user's model got
better. `--model` or `ANSWER_QUALITY_MODEL` must explicitly select the answering
model; the examples above use the model implicated in the teaching reports.
`--reasoning-effort` or `ANSWER_QUALITY_REASONING_EFFORT` selects its effort.
Omitting effort uses the provider's default and is recorded as unspecified.
If using an automatic
grader, select a different model family with `ANSWER_QUALITY_GRADER` and inspect
its evidence; a grader verdict alone is not a release decision. Grader effort
can be set independently with `ANSWER_QUALITY_GRADER_REASONING_EFFORT`.

The runner sends one request per answer and one per grade with Council disabled.
It does not retry failed calls silently or impose the old 2,400-token answer
limit. A response without `finish_reason: stop` is recorded as unfinished and
is not graded. With `--json`, results are saved after every stage, including
errors and partial completions, along with the exact prompt, prompt hash,
question, rubric, requested/reported model, effort, usage and elapsed time.
Any deliberate retry must use a separate report so the original remains visible.

This runner is a smoke test of one writing response. It composes the current
chat instructions with a web-only capability decision, supplies evidence
inline, and does not run tools. It neither compares two instruction setups
automatically nor reproduces the complete normal-chat capability inventory.
For a product comparison, use matched saved prompts or checkouts with the full
capability context. The recorded prompt makes that boundary inspectable.

Verify the runner without provider calls using:

```
node --test qa/answer-quality/evaluator.test.mjs
```

Teaching must use the chat's selected model. A stronger-model comparison can
diagnose a limitation, but cannot justify silently routing explanations to a
different model or count as an improvement to the selected model.

Compare unchanged requests and source material against a saved baseline prompt
or checkout, with the same model settings. Normal chat uses the shared
`hermes-config/system/chat-core.md` contract; legacy answer-depth and meta-prompt
flags do not remove it. Preserve capability availability in both arms. Record
completion failures and latency as well as quality, and distinguish a writing
replay with sources supplied from an end-to-end chat that retrieves them.

Prioritize explanatory quality over shaving minutes from a completed lesson:
the user accepts a seven-minute explanation when it teaches well. Investigate
ordinary teaching turns lasting 45 minutes or more. Separate actual model/tool
activity from waiting, interruption, and stale pre-dispatch placeholders; an
old pending message finalized on reopening is not evidence of continuous
reasoning for that entire interval.

## The seeds

The original three scenarios in `scenarios.json` marked `"origin": "seed"` were not mined
from ratings; they encode restraints the existing contracts already state, and
exist so the suite is not vacuous before the first real complaint is promoted.
Each targets an *overcorrection*: the one-fact question that gets a survey, the
stated constraint that gets dropped in favour of the more familiar question, and
the confident answer to a question the supplied material is silent on.

The `teaching-*` seeds extend this with probability, biology, programming,
language, a fictional source packet, AC circuit analysis, and a literal-edit
control. Judge whether the answer actually constructs the missing connection,
not whether it includes words such as "why", "intuitive", or "first principles".
The circuit case checks derivation and physical meaning; unrelated subjects
check whether the same improvement transfers. Keep examples in this evaluation
set rather than adding a new subject-specific instruction after each failure.

The buoyancy, logarithm and database-index cases marked `reviewed-benchmark`
were promoted after reviewing the independent eight-topic comparison on
2026-09-30. They are now development regressions. Once a candidate is tuned
against them, use new questions for confirmation; passing these cases is not
independent evidence of generalization. The comparison found modest, uneven
gains from instruction cleanup, with important reasoning gaps remaining.
