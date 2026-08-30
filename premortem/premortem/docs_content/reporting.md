# Reporting

Premortem's primary reporting artifact is structured context for a downstream
writing agent:

```bash
premortem report context
```

By default this writes `.premortem/output/report-context.json`. The bundle
contains the initiative and failure statement, personas, verbatim reasons,
causal graph and paths, scores and risk ranking, mitigations, research agenda,
coverage gaps, provenance, and a report-writing brief.

Give that JSON file to a writing agent together with the intended audience,
format, tone, and decision context. The writing agent should:

- Lead with the decision and recommendation.
- Preserve entity IDs so important claims remain traceable.
- Distinguish synthetic persona material from empirical evidence.
- Explain the dominant causal paths rather than dumping every graph element.
- Surface missing scores, uncovered risks, and unresolved assumptions.
- Never invent facts, owners, costs, probabilities, or research findings.

An ingested executive summary is optional source material. It is not required
to build the context bundle and should not constrain the writing agent.

`premortem report html` and `premortem report generate` remain available as
quick deterministic renderers, but they are convenience outputs rather than
the canonical reporting workflow.
