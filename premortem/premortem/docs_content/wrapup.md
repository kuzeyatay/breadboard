# Premortem Wrap-Up Guide

Use this guide when handing the completed analysis back to the user.

## Required handoff

Lead with:

1. The bottom-line recommendation in one or two sentences.
2. The two or three causal mechanisms that drive it.
3. The evidence or conditions that would change the recommendation.
4. The highest-leverage research the user should complete next.
5. The path to `.premortem/output/report-context.json` and any report written
   from it.

The user owns the decision. Describe recommendations as conclusions from the
failure paths surfaced by the exercise, not as authoritative verdicts.

## Reporting boundary

The report-context JSON is Premortem's canonical reporting artifact. A
downstream writing agent may use it to create an audience-specific report.
Name both the context bundle and any downstream report in the handoff.

Do not treat a convenience HTML or Markdown rendering as more authoritative
than the structured context.

## Research homework

Select the two or three unresolved assumptions most likely to change the
decision. For each:

- Name the proposed method and population or data source.
- State the decision threshold.
- Suggest an owner and useful timeframe when the available context supports
  doing so.
- Label third-party dependencies as blockers.

Do not invent owners, timing, thresholds, or evidence missing from the
analysis. Ask the user when those choices matter.

## Avoid

- Restating every persona, reason, or graph element in chat.
- Hiding a clear recommendation beneath generic caveats.
- Presenting synthetic personas as observed stakeholder evidence.
- Claiming completion when important graph nodes remain unscored or
  unmitigated without acknowledging the gap.
- Saying only that a file was generated.
