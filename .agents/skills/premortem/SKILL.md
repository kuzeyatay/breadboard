---
name: premortem
description: Facilitate a Gary Klein-style pre-mortem for a planned initiative, identify concrete failure paths from distinct stakeholder perspectives, map and score a causal graph, define mitigations, and publish a reusable risk report.
---

# Premortem

Facilitate a conversation-scoped pre-mortem using the cloned Premortem CLI as
the source of truth. The dedicated tool owns isolated state and command
validation. Do not edit `.premortem` files directly.

breadboard:
  category: prebuilt
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - premortem_run
    - artifact_create
    - artifact_render
  requiredArtifactKinds: [markdown]
  requiredRuntimes: [markdown-renderer]
  requiredMcpServers: []
  optionalMcpServers: []

## Start and scope

1. Call `premortem_run` with `{"arguments":["agent-start"]}` at the start of
   every selected turn. Resume the phase reported by the CLI instead of
   restarting completed work.
2. Ask only what planned initiative should be analyzed. In Garden Chat, use
   relevant grounded Garden context to suggest assumptions, but still ask the
   user to confirm consequential details. Never imply that Garden evidence is
   conversation memory.
3. Ask at most one or two tailored follow-ups about details that would materially
   change the analysis. Do not present an intake checklist.
4. Draft a concise initiative name, contextual description, and vivid
   completed-fact failure statement describing outcomes rather than causes.
   Obtain user approval before calling `init`.

Pass each CLI argument as its own array item and omit the leading
`premortem`. For example:

```json
{
  "arguments": [
    "init",
    "--initiative",
    "September partner launch",
    "--failure",
    "The launch missed its adoption target and damaged partner confidence.",
    "--description",
    "A cross-company launch planned for September."
  ]
}
```

## Facilitate the analysis

Follow `next_actions` and the returned workflow state. After every material
state change, call `workflow next`; before beginning a phase, call
`workflow guide <phase>`.

- Create four to six specific, distinct personas with `persona add`, then pause
  for user review and approval.
- Add concrete episodic failure chains and structural factors with `reason add`.
  Avoid generic management-language risks.
- Synthesize a causal graph of roughly eight nodes and ten labelled edges using
  `graph add-node` and `graph add-edge`: three or four root causes, two or three
  intermediate effects, and one or two terminal outcomes. Pause for approval
  once the graph is readable and complete.
- Score decision-relevant nodes with `score set`, including the evidence or
  reasoning behind likelihood and impact.
- Add mitigations tied to graph node IDs. Each mitigation should name an owner,
  action, timing, and success signal.
- Turn important unresolved assumptions into explicit research questions in
  the conversational report. Paid/model EDSL jobs and arbitrary result ingest
  are not part of this Breadboard capability.

Use only commands accepted by `premortem_run`. Do not attempt deletes, graph
removals, forced re-initialization, arbitrary project/output paths, file ingest,
or EDSL job execution. Ask before overwriting an existing entity through an
allowed edit command.

## Validate and publish

1. Call `workflow validate` and resolve errors. Explain any remaining warnings.
2. Call `report context` to create the canonical evidence bundle inside the
   conversation workspace.
3. Call `report generate` without an output path. Read the Markdown from
   `envelope.data.markdown`.
4. Publish that Markdown with `artifact_create` using:
   - `kind: "markdown"`
   - `renderer: "markdown"`
   - a specific title
   - `sourceSkill: "premortem"`
   - `render: true`
   - metadata noting the initiative and that the report is a prospective risk
     exercise, not a prediction
5. If needed, call `artifact_render`. Keep the final chat response concise and
   point to the persistent artifact rather than pasting the report.
6. Call `agent-end` before handoff and address any incomplete-state warnings.

The artifact automatically remains attached to the conversation where it was
created. Never recreate it in a different active chat.

## Approval checkpoints

Stop and wait for explicit user approval:

- before initialization, after presenting the failure statement;
- after proposing the persona set;
- after presenting the causal graph;
- before replacing previously approved entities.

Facilitate the method in plain language. The user should not need to know the
CLI or pre-mortem methodology in advance.
