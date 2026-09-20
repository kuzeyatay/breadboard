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
node --experimental-strip-types scripts/evaluate-answer-quality.mjs
node --experimental-strip-types scripts/evaluate-answer-quality.mjs --scenario one-fact-question-gets-the-fact
node --experimental-strip-types scripts/evaluate-answer-quality.mjs --reason too_long --json report.json
```

Opt-in, like `evaluate-evidence-calibration.mjs`, because it costs provider calls
and because a grader model is not a deterministic oracle — it belongs in a
reviewed run, not the per-commit suite.

Two things carried over from evaluating the evidence-calibration contract, both
learned the hard way:

- **Use a weak answering model.** A strong one passes the set either way, so the
  delta from a contract change only shows on something like
  `cliproxy/gemini-3-flash`. `ANSWER_QUALITY_MODEL` sets it.
- **Grade with a different model family than the one answering.**
  `ANSWER_QUALITY_GRADER` sets it.

Compare against a baseline by running with the relevant gate off —
`ENABLE_ANSWER_DEPTH=0`, `ENABLE_META_PROMPTING=0` — not by reading the raw pass
count, which says little on its own.

## The seeds

The three scenarios in `scenarios.json` marked `"origin": "seed"` were not mined
from ratings; they encode restraints the existing contracts already state, and
exist so the suite is not vacuous before the first real complaint is promoted.
Each targets an *overcorrection*: the one-fact question that gets a survey, the
stated constraint that gets dropped in favour of the more familiar question, and
the confident answer to a question the supplied material is silent on.
