# premortem — structured pre-mortem failure analysis CLI
<!-- id: premortem/premortem -->

![Expected Parrot premortem mark: a parrot skeleton inside brackets](docs/assets/premortem-mark.png)

[View the project website](https://expectedparrot.github.io/premortem/)

premortem runs a Gary Klein-style pre-mortem workflow for decisions, launches, projects, and strategies: define the imagined failure, generate stakeholder personas, elicit failure reasons, build a causal graph, score nodes, create mitigations, form a research agenda, and render a report. The agent uses it as an active facilitator, stopping at approval checkpoints before escalating from imagined failure to mitigations and final recommendations.

## Copy and paste into Codex or Claude Code

```text
Set up Premortem and facilitate a structured pre-mortem with me.

Install the current Premortem and EDSL `main` branches from GitHub. If `uv` is
not installed, first run `python -m pip install --upgrade uv`. Then install both
CLIs as a managed tool. `uv tool install` provides an isolated environment
without relying on a project virtual environment or shell activation:

uv tool install --upgrade --force \
  --with-executables-from "edsl @ git+https://github.com/expectedparrot/edsl.git@main" \
  "premortem @ git+https://github.com/expectedparrot/premortem.git@main"

Verify that both command-line tools are available:

uv tool dir --bin
command -v premortem
command -v ep
premortem --help
ep --help

Confirm that `command -v` resolves both commands inside the directory reported
by `uv tool dir --bin`. If either command resolves to an older installation,
do not use it: run `uv tool update-shell`, verify again, or invoke the commands
by their absolute paths in the uv tool bin directory.

Run `ep auth status`. If authentication is missing, run `ep auth login` and
follow its login flow; let the EDSL CLI create and manage the repository-local
`.env`. Never display, copy, or commit API keys. Then run `ep profiles current`
to inspect the redacted configuration and `ep check` to verify connectivity.

Once setup succeeds, run `premortem agent-start`. Treat its JSON envelope as
the source of truth and follow its `next_actions`. Continue using the commands
it surfaces until the workflow is complete or my approval is required.
```

`agent-start` supplies the method, approval checkpoints, current phase, and
next commands; the pasted prompt only handles installation and authentication.

The tutorial uses one [maintained fictional example](examples/colgate-kitchen/README.md):
Colgate launching a heat-and-serve entrée line led by family-size lasagna.

## Output contract

Commands emit one JSON envelope by default:

```json
{
  "schema_version": "1.0",
  "ok": true,
  "command": ["status"],
  "data": {},
  "warnings": [],
  "next_actions": []
}
```

Failures set `ok` to `false`, replace `data` with a structured `error`, and exit nonzero. Use `--human` for interactive Rich output.

## When to use this
<!-- id: premortem/when-to-use -->

- The user is about to launch, approve, fund, or commit to a plan and wants to surface failure modes first.
- The task benefits from stakeholder perspectives, causal links, mitigations, and research questions.
- The user wants a structured artifact rather than an informal risk brainstorm.
- The agent can iteratively review personas, reasons, graph, and mitigations with the user.

## When this is a stretch (and how to adapt)
<!-- id: premortem/when-stretch -->

- The user has not chosen a plan yet. Use premortem on the leading option, or use [mcda](#mcda/mcda) first to compare options.
- The risks are mostly external strategic futures. Use [kahn](#kahn/kahn) for scenario planning, then run premortem on the chosen strategy.
- The user wants probability-weighted decision analysis. Use premortem to identify failure nodes, then [raiffa](#raiffa/raiffa) for probabilistic modeling if probabilities are defensible.
- The user only needs a quick risk list. Run a lightweight workflow through personas/reasons and skip generated EDSL jobs unless deeper analysis is useful.
- The project is sensitive. Keep personas role-based, avoid confidential details in generated jobs, and inspect artifacts before sharing.

## Decision rule for the calling agent
<!-- id: premortem/decision-rule -->

Before dispatching to premortem, confirm:

1. There is a concrete plan, launch, decision, or strategy to imagine failing.
2. The user wants causes of failure before final commitment.
3. Stakeholder perspectives or personas would improve the analysis.
4. Mitigations or research agenda are desired outputs.

If yes to the first two and either the third or fourth, premortem is the right method.

## Inputs and elicitation
<!-- id: premortem/inputs -->

### Failure statement
<!-- id: premortem/inputs-failure-statement -->

What it is: a vivid statement that the project failed in the future.

How the agent elicits this:
- Ask what plan is being evaluated and what "failure" would mean.
- Make the failure concrete: date, outcome, harmed stakeholders, missed metric, or unacceptable loss.
- Avoid vague statements like "the project does not go well."

Default to suggest: "It is <date>, and <project> has failed because <business/user/outcome metric> did not materialize."

Fallback: if the user cannot define failure, ask for the top three outcomes they most need to avoid and turn the most important into the failure statement.

### Personas and stakeholder lenses
<!-- id: premortem/inputs-personas -->

What it is: roles or perspectives used to generate diverse failure reasons.

How the agent elicits this:
- Ask who could see different risks: customer, operator, sales, engineering, legal, finance, frontline user, skeptic, executive.
- Ask whether personas should be realistic named roles or generic stakeholder types.
- Keep personas distinct in incentives, information, and pain points.

Default to suggest: 4-6 stakeholder personas spanning builder, buyer/user, operator, skeptic, and decision owner.

Fallback: if the user is in a hurry, use role-based default personas and let the user edit after generation.

### Failure reasons and causal graph
<!-- id: premortem/inputs-reasons-graph -->

What it is: plausible causes of failure and links among them.

How the agent elicits this:
- Ask each persona to imagine why the failure happened.
- Separate symptoms from root causes.
- Ask which reasons cause or amplify other reasons.
- Score nodes by severity, controllability, uncertainty, and evidence where supported.

Default to suggest: collect many reasons first, then cluster and graph; do not jump to mitigations too early.

Fallback: if reasons are generic, ask for concrete operational mechanisms and affected stakeholders.

### Mitigations and research agenda
<!-- id: premortem/inputs-mitigations-research -->

What it is: actions to reduce failure risk and research questions that would resolve key uncertainties.

How the agent elicits this:
- For each high-priority node, ask what could prevent, detect, or respond to it.
- Ask for owner, timing, effort, and evidence needed.
- Distinguish mitigations that can be done now from research needed before committing.

Default to suggest: 1-3 mitigations per high-risk node and a short research agenda focused on uncertainties that change decisions.

Fallback: if mitigations are too broad, rewrite them as concrete actions with owner and trigger.

## Outputs
<!-- id: premortem/outputs -->

premortem produces:

- `.premortem/` project state with failure statement, personas, reasons, causal graph, scores, mitigations, research agenda, and report artifacts.
- Portable, model-free EDSL `Jobs` packages for persona/reason/mitigation/research phases.
- EDSL `Results` packages run explicitly with `ep run` and ingested into project state.
- Workflow/status output with current phase and next steps.
- A canonical JSON reporting bundle for a downstream writing agent.
- Optional deterministic Markdown and HTML renderings.

## Workflow
<!-- id: premortem/workflow -->

Canonical sequence:

1. `premortem init` — create the project and failure statement.
2. `premortem persona ...` or `premortem job generate personas` — define or package stakeholder personas.
3. Review personas with the user before proceeding.
4. `premortem reason ...` or `premortem job generate reasons` — define or package failure-reason elicitation.
5. Review and cluster reasons; remove duplicates or generic entries.
6. `premortem graph ...` — build causal links among reasons.
7. `premortem score ...` — score important nodes.
8. `premortem mitigate ...` or `premortem job generate mitigations` — define or package mitigation elicitation.
9. `premortem job generate research-agenda` — package research-agenda elicitation.
10. `premortem report context` — export evidence, derivations, provenance, and a writing brief.
11. Give the context bundle and audience requirements to a report-writing agent.

Use `premortem status` and `premortem workflow` whenever resuming or after generated job ingestion.
Use `premortem workflow validate` after direct state edits or before exporting
report context; it reports dangling references, duplicate edges, self-loops,
and causal cycles without changing the project.

## Worked examples
<!-- id: premortem/examples -->

### Pre-mortem for a product launch
<!-- id: premortem/example-product-launch -->

User: "We’re about to launch a new analytics feature. Can you run a premortem?"

Agent: "Yes. First I need a concrete failure statement. A useful version is: 'It is six months after launch, and the analytics feature failed because adoption stayed below 10% and support burden increased.' Does that match the failure you care about?"

User: "Yes, adoption below 10% is the main failure."

Agent: "I’ll create stakeholder personas for customer admin, end user, support, sales, engineering, and skeptical executive. After you approve those, I’ll elicit failure reasons and build the causal graph before proposing mitigations."

```bash
premortem init --initiative "Analytics launch" --failure "It is six months after launch, and the analytics feature failed because adoption stayed below 10%."
premortem persona add --name customer_admin --role "Customer admin"
premortem persona add --name support_lead --role "Support lead"
premortem job generate reasons --domain "analytics setup, support capacity, adoption targets" --good-example "Admins cannot map existing roles during setup, so pilot accounts never invite end users." --output jobs/reasons.jobs.ep
ep run jobs/reasons.jobs.ep --model <model-name> --output jobs/reasons-results.ep
premortem ingest reasons --from jobs/reasons-results.ep
premortem graph add-node --label "A concrete cause" --reason r001
premortem score set --node n001 --likelihood high --impact high
premortem job generate mitigations --good-example "Before launch, the owner runs a five-account migration pilot." --output jobs/mitigations.jobs.ep
ep run jobs/mitigations.jobs.ep --model <model-name> --output jobs/mitigations-results.ep
premortem ingest mitigations --from jobs/mitigations-results.ep
premortem report context
```

Output: stakeholder-specific failure reasons, causal graph, scored risks,
mitigations, research material, and a canonical context bundle for a writing
agent.

### Resuming after generated jobs
<!-- id: premortem/example-resume-ingest -->

```bash
premortem status
premortem ingest reasons --from jobs/reasons-results.ep
premortem workflow next
premortem reason list
premortem graph list
```

Output: updated project state and next-step guidance after AI-assisted outputs are ingested.

## Quick command reference
<!-- id: premortem/commands -->

For full options, run `premortem <subcommand> --help`.

| Command | Purpose |
|---|---|
| `premortem agent-start` | Give an agent its contract, current phase, guide, and next actions. |
| `premortem init` | Initialize a pre-mortem project. |
| `premortem project ...` | Manage project metadata. |
| `premortem status` / `workflow` | Show phase, state, and next steps. |
| `premortem workflow validate` | Check cross-entity and causal-graph integrity. |
| `premortem persona ...` | Manage stakeholder personas. |
| `premortem reason ...` | Manage failure reasons. |
| `premortem graph ...` | Build and inspect causal graphs. |
| `premortem score ...` | Score causal graph nodes. |
| `premortem mitigate ...` | Manage mitigations. |
| `premortem report context` | Export the canonical JSON bundle for a report-writing agent. |
| `premortem report html` | Optionally generate a standalone HTML rendering. |
| `premortem job generate ...` | Build portable, model-free EDSL Jobs `.ep` packages. |
| `premortem ingest ...` | Ingest EDSL Results `.ep` packages. |
| `premortem report ...` | Export report context or generate convenience Markdown. |
| `premortem docs` | Read built-in guidance. |

## Common pitfalls
<!-- id: premortem/pitfalls -->

- A vague failure statement produces generic risks; make the imagined failure concrete.
- Jumping to mitigations before reasons and causal links are reviewed loses the value of the premortem.
- Personas should have distinct information and incentives, not just different names.
- Mitigations need owners, timing, and triggers or they become wish lists.
- AI-generated reasons should be reviewed for duplicates, plausibility, and missing stakeholder perspectives.

## Cross-references
<!-- id: premortem/xrefs -->

- Upstream: [kahn](#kahn/kahn) can identify strategic futures before testing a chosen plan; [mcda](#mcda/mcda) can select the plan to stress-test.
- Downstream: [raiffa](#raiffa/raiffa) can model high-priority uncertain failure paths; [gutenberg](#gutenberg/gutenberg) compiles reports.
- Adjacent methods: [dcf](#dcf/dcf) for financial downside scenarios; [messick](#messick/messick) for validating agent-generated findings when used in studies.

## State contract
<!-- id: premortem/state -->

`.premortem/` stores project metadata, personas, reasons, graph nodes/edges, scores, mitigations, research agenda, ingested results, and report artifacts. The CLI-managed project state is the source of truth; portable EDSL Jobs/Results packages and rendered reports are derived artifacts.

## JSON output and error codes
<!-- id: premortem/json -->

Every command emits the same versioned JSON envelope by default. `next_actions`
distinguishes executable commands from facilitator instructions and marks
networked, mutating, or approval-sensitive actions. Common recoverable failures
include missing project state, absent failure statement, incomplete persona set,
duplicate or unlinked reasons, graph validation issues, missing generated job
results, and report prerequisites.
