# Pre-mortem Facilitation Guide

A pre-mortem is a structured prospective-hindsight exercise. Instead of asking
whether an initiative might fail, it states that the initiative has already
failed and asks how that failure happened.

That certainty matters. It lets participants stop defending the plan and start
describing concrete breakdowns, hidden dependencies, stakeholder incentives, and
failure paths that are hard to surface in ordinary risk reviews.

The output is not a prediction. It is a decision aid: a set of plausible failure
mechanisms, a simple causal graph, concrete mitigations, and research questions
that should be answered before launch.

## Core Rules

- State failure as a completed fact.
- Describe consequences in the failure statement, not causes.
- Use specific domain details, not generic management language.
- Use diverse stakeholder personas to generate different failure stories.
- Keep the causal graph simple enough to read quickly.
- Tie mitigations to graph nodes.
- Treat unresolved assumptions as research questions.

## Standard Command Sequence

The default project directory is `.premortem/`. Use `--project-dir` when working
outside the current directory.

## If You Are Facilitating For A User

Do not expect the user to provide a polished failure statement. The facilitator
should help create it.

Start with one question:

> What planned initiative should we analyze?

Do not immediately ask for stakeholders, timeline, scale, constraints, systems,
budget, dependencies, and success criteria as a single checklist. First listen
to the initiative. Then identify the one or two missing details that would most
change the analysis and ask tailored follow-ups.

Suggest plausible answers as you go so the user can react instead of inventing
everything from scratch. For example:

> For this launch, the details most likely to matter are the target customer,
> launch timing, and what would count as a visibly bad outcome. My initial
> assumptions are [specific suggestions]. Which should I revise?

Use facts the user has already supplied. Do not ask again for information that
can be reasonably inferred, and do not turn intake into a form. After one or
two short conversational rounds, draft:

- A concise initiative name.
- A description using the user's context.
- A completed-fact failure statement that describes bad outcomes and leaves
  causes out.

Show that draft to the user for approval or edits before running
`premortem init`. The user should not need to know how to write a pre-mortem
failure statement in advance.

### 1. Initialize The Project

Draft a vivid failure statement before running this command. It should say what
went wrong in outcome terms and avoid explaining why. If you are an agent, draft
this yourself from the intake and ask the user to approve it.

```bash
premortem init \
  --initiative "<initiative name>" \
  --failure "<definitive failure statement>" \
  --description "<initiative context, stakeholders, timeline, constraints>"
```

Check your position:

```bash
premortem workflow next
premortem docs show failure-statement
```

### 2. Generate And Ingest Personas

Build a portable, model-free EDSL Jobs package:

```bash
premortem job generate personas \
  --context "<domain expert perspective>" \
  --requirements "<role 1>,<role 2>,<role 3>,<role 4>,<role 5>" \
  --output jobs/personas.jobs.ep
```

Run and ingest:

```bash
ep inspect jobs/personas.jobs.ep
ep jobs cost jobs/personas.jobs.ep
ep run jobs/personas.jobs.ep --model <model-name> --output jobs/personas-results.ep
premortem ingest personas --from jobs/personas-results.ep
premortem persona list --human
```

Pause here. Review whether the personas are specific, realistic, and distinct
before generating reasons.

### 3. Generate And Ingest Failure Reasons

Give the job concrete domain details and one strong example of the specificity
you expect.

```bash
premortem job generate reasons \
  --domain "<specific systems, dates, offices, budgets, stakeholders>" \
  --good-example "<specific failure chain grounded in the domain>" \
  --output jobs/reasons.jobs.ep
```

Run and ingest:

```bash
ep inspect jobs/reasons.jobs.ep
ep run jobs/reasons.jobs.ep --model <model-name> --output jobs/reasons-results.ep
premortem ingest reasons --from jobs/reasons-results.ep
premortem reason list --human
```

The result should include episodic event chains and structural factors. If the
output reads like generic risk bullets, regenerate with a stronger example.

### 4. Build The Causal Graph

The graph is analyst work. Do not delegate it blindly to EDSL. Read the reasons,
then synthesize about eight nodes and ten edges.

```bash
premortem reason list --human
premortem graph add-node --label "<specific root cause>" --reason r001
premortem graph add-node --label "<specific intermediate effect>" --reason r004
premortem graph add-node --label "<terminal failure outcome>"
premortem graph add-edge --from n001 --to n004 --label "<causal mechanism>"
premortem graph list --human
```

Target:

- 3-4 root causes.
- 2-3 intermediate effects.
- 1-2 terminal outcomes.

Pause here. The graph should be readable in under 30 seconds and should show
where multiple causes converge.

### 5. Score Decision-Relevant Nodes

Score the graph before proposing interventions. Focus on nodes that materially
influence the decision, and record the basis for each judgment.

```bash
premortem graph list --human
premortem score set \
  --node n001 \
  --likelihood high \
  --impact high \
  --notes "<evidence and reasoning for the ratings>"
```

Do not confuse a high-impact terminal outcome with an actionable root cause.
The report context preserves both the ratings and their notes.

### 6. Generate And Ingest Mitigations

Mitigations should name node IDs and specify who does what by when.

```bash
premortem job generate mitigations \
  --good-example "<specific action that targets n001 by owner and date>" \
  --output jobs/mitigations.jobs.ep
```

Run and ingest:

```bash
ep inspect jobs/mitigations.jobs.ep
ep run jobs/mitigations.jobs.ep --model <model-name> --output jobs/mitigations-results.ep
premortem ingest mitigations --from jobs/mitigations-results.ep
premortem mitigate list --human
```

Review any mitigations with no node targets and either map them to graph nodes
or treat them as weak/unusable.

### 7. Generate The Research Agenda

The research agenda identifies assumptions that are important, uncertain, and
testable before launch.

```bash
premortem job generate research-agenda --output jobs/research-agenda.jobs.ep
ep run jobs/research-agenda.jobs.ep --model <model-name> --output jobs/research-agenda-results.ep
premortem ingest research-agenda --from jobs/research-agenda-results.ep
```

The generated items are structured records containing the assumption,
uncertainty, method, population, decision threshold, and relevant node IDs.
Review them as decision tests, not a generic list of topics to investigate.

### 8. Validate And Export Report Context

Check the project before handing it to another agent:

```bash
premortem workflow validate
```

Resolve any errors. Warnings identify coverage gaps—such as unscored or
unmitigated nodes—that may be intentional but should be acknowledged.

Export the canonical evidence bundle for a downstream writing agent:

```bash
premortem report context
```

Give `.premortem/output/report-context.json` to the writing agent together with
the audience, format, tone, and decision context. The bundle includes the raw
evidence, graph, derived rankings and paths, coverage gaps, provenance, and a
writing brief. An executive-summary job is optional source material, not a
prerequisite.

Direct Markdown and HTML generation remain available as convenience renderers:

```bash
premortem report generate --output writeup/report.md
premortem report html --output report.html
```

Check artifacts:

```bash
premortem workflow artifacts
```

## Useful Sense-Making Commands

```bash
premortem status --human
premortem workflow phase
premortem workflow next
premortem workflow checklist
premortem workflow guide causal-graph
premortem docs search "<question>"
```

## What Good Looks Like

The final analysis should answer:

1. What does definitive failure look like?
2. Which stakeholders see the failure differently?
3. What event chains and structural factors plausibly lead to failure?
4. Which root causes converge into the most dangerous pathways?
5. What concrete actions could break those pathways before launch?
6. What uncertainties should be tested before making a go/no-go decision?
