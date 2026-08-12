---
name: agent-loop-engineering
description: Turn a repeated agent task into a bounded loop contract with a risk class, trigger, inputs, verification, human gates and stop conditions, then validate it, score it, dry-run it and publish an audit receipt before any scheduling or automation planning.
---

# Agent Loop Engineering

Design bounded agent loops using the cloned Agent Loop Engineering Kit as the
source of truth. The `agent_loop_run` tool owns the kit's contract commands and
runs them inside this conversation's isolated workspace.

breadboard:
  category: prebuilt
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - agent_loop_run
    - artifact_create
    - artifact_render
  requiredArtifactKinds: [markdown]
  requiredRuntimes: [markdown-renderer]
  requiredMcpServers: []
  optionalMcpServers: []

## Default stance

Manual first. Read-only first. Receipt always. Automation later.

Do not automate a vague prompt. Design the loop, validate the contract, score
it, dry-run it, and read the receipt. Only then discuss activation.

## What this capability does and does not do

The kit designs, checks and dry-runs a loop *contract*. It never executes the
loop's real task, and it never creates a schedule, webhook, Kanban job or
GitHub automation. A dry run proves the contract is bounded and readable — it
does not prove the loop's answers are true.

## Calling the tool

Pass each argv item as its own array item and omit the leading `hermes-loop`.
Every path is relative to this conversation's workspace; absolute paths, `..`
and drive letters are rejected.

```json
{ "arguments": ["validate", "loops/daily-briefing.yaml", "--json"] }
```

Available commands:

- `init <path>` — write the loop-spec template (add `--force` to overwrite)
- `validate <path...> [--json]` — schema and safety-gate check
- `score <path...> [--json]` — loop-engineering quality score out of 100
- `dry-run <path> --out <dir> [--min-score N] [--json]` — writes
  `<dir>/run-record.yaml` and `<dir>/receipt.md`
- `render-receipt <run-record.yaml>` — readable Markdown receipt on stdout
- `privacy-scan [path] [--json]` — common secret and private-path leaks; omit
  the path to scan the whole workspace

`smoke` is not available: upstream implements it by shelling out to the
repository's own scripts and test suite.

## Operating sequence

1. Start from the user's repeated task in plain language. Ask what actually
   repeats, what it reads, and what would count as the run having gone wrong.
2. Classify risk with the user, and say the class out loud:
   - L0 advisory — one-off, cite uncertainty
   - L1 repeated read-only — source list, receipt, timeout
   - L2 local reports and state — privacy scan, bounded write paths
   - L3 repo or file edits — isolated work, tests, diff, reviewer, rollback
   - L4 external side effects — approval every run
   - L5 secrets, money, deletion, legal or production — blocked by default
3. Call `init` to write the template into the workspace, then rewrite it into a
   real spec for this task. Fill every section: `trigger`, `inputs`, `state`,
   `tools.allowed`, `tools.forbidden_actions`, `isolation`, `verification`,
   `stop_conditions`, `human_gate`, `outputs` and `receipt`.
4. Call `validate`. Fix every error before continuing.
5. Call `score`. Below 85, improve the lowest-scoring category and score again
   rather than moving on.
6. Call `dry-run` with an `--out` directory in the workspace, then
   `render-receipt` on the produced `run-record.yaml`.
7. Call `privacy-scan` on the spec directory before anything is shared.
8. Publish the receipt with `artifact_create` using `kind: "markdown"`,
   `renderer: "markdown"`, a specific title, `sourceSkill:
   "agent-loop-engineering"`, `render: true`, and metadata noting that the run
   was a contract dry run rather than a real execution. Call `artifact_render`
   if needed, and keep the chat reply short, pointing at the artifact.
9. Only after a clean dry run, describe the manual first real run: one
   read-only attempt, run by the user, reporting inputs used, actions taken,
   verification output, stop reason, unresolved risks and receipt path.

## Definition of done

A loop is ready only when it has a trigger, inputs, state and context rules;
allowed tools and forbidden actions; an isolation mode; deterministic
verification; review checks wherever judgement is required; max iterations and
runtime; a human-gate approval format; a receipt path with a readable receipt;
and a clean privacy scan for anything shared.

## Hard brakes

Never quietly design a loop that deletes files or data, reads or prints
secrets, posts publicly, deploys to production, touches billing or payments,
auto-merges or auto-pushes, schedules recurring runs, or weakens its own safety
gates. Each of those belongs in `human_gate.required_for` with the spec's
approval format:

```text
APPROVE LOOP ACTION: <action> / <scope> / <rollback>
```

Breadboard does not schedule anything from this skill. If the user wants the
loop to run on a schedule, hand them the validated spec and the activation
conditions, and let them set it up deliberately.

## Stop conditions to write into every spec

Stop and report when a required input is missing, verification fails, the same
error repeats, max iterations or runtime is reached, a forbidden action is
touched, or a human gate is hit. A loop that keeps trying alternatives after a
failure is automated damage, not resilience.
