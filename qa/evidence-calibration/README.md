# Evidence calibration, evaluation set

Seven scenarios that hold Bread to the evidence-calibration contract
(`hermes-config/system/evidence-calibration.md`, engaged per turn by
`dashboard/src/lib/hermes/evidence-calibration.ts`). Each one supplies material,
asks a question about it, and declares the properties a calibrated answer must
and must not have.

The set is spread across medicine, finance, technical diagnosis, law and
engineering deliberately. The behaviour under test is general, so a set that
only covered one kind of report would let a case-fitted fix pass.

| scenario | what it is for |
| --- | --- |
| `derived-metric-vs-in-range-component` | a calculated value is out of range while the input it was computed from sits inside its own stated interval |
| `pattern-with-several-explanations` | a pattern several causes would produce equally well, which must not become one diagnosis |
| `one-metric-past-target-is-not-distress` | one metric past its covenant target, which alone does not establish distress |
| `symptoms-fit-several-root-causes` | symptoms compatible with more than one root cause, plus a gap in the evidence |
| `clause-excerpt-cannot-settle-the-question` | supplied text that cannot support a categorical legal conclusion |
| `benign-finding-in-context` | a reassuring result that deserves "not concerning here", not "harmless" |
| `control-evidence-supports-a-definite-answer` | evidence that genuinely settles the question, so the answer must stay confident |

## Two layers

The arithmetic half runs on every commit and needs no provider:

```
cd dashboard && node --test --experimental-strip-types tests/evidence-calibration.test.mjs
```

It checks classification, that each value is placed on the correct side of the
bound its own source printed, and that the composed system prompt carries the
result. Nothing in it depends on a model.

The semantic half needs a live model and is opt-in, because a grader model is
not a deterministic oracle:

```
EVIDENCE_EVAL_MODEL=cliproxy/claude-sonnet-5 \
EVIDENCE_EVAL_GRADER=cliproxy/gemini-3-flash \
node --experimental-strip-types scripts/evaluate-evidence-calibration.mjs --json report.json
```

It composes the real system prompt, answers each scenario, and grades every
property on meaning. Use a grader from a different model family than the
answerer so a model is not marking its own work. `--scenario <id>` runs one.
`ENABLE_EVIDENCE_CALIBRATION=0` runs the same set without the per-turn section,
which is how the before and after are compared.

Properties are written as behaviour, never as wording. An answer that satisfies
one in its own words satisfies it, so no rubric line should ever be turned into
a search for a particular sentence.
