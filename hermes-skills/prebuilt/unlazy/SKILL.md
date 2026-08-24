---
name: unlazy
description: Apply completion discipline to substantial multi-part work by defining observable acceptance gates before execution, checking returned work, and reporting only what the evidence supports. Use for every turn as a standing decision discipline; trivial replies and single factual answers should explicitly take the lightweight path instead of creating a ledger.
license: MIT
metadata:
  source: https://github.com/Leonxlnx/unlazy
  upstream_revision: 754d9a6
  upstream_version: 2.1.0
---

# Unlazy

Make incomplete work visible and completion testable. Use this discipline on
every turn to decide how much structure the request earns. It is an internal
quality contract, not a reason to make a small answer feel heavy.

breadboard:
  category: reviewed-guidance
  surfaces: [dashboard_terminal, garden_chat, quartz_ai]
  requiredTools: []
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## Pick the lightest honest mode

- For a greeting, a short factual reply, or a genuinely trivial edit, answer
  directly. Do not create gates merely to demonstrate that this skill is loaded.
- For substantial autonomous work, define the acceptance gates before doing the
  work. A task is substantial when quiet partial completion would matter: it is
  long, multi-part, exhaustive, delegated, implementation-heavy, or explicitly
  asks not to stop before an outcome is reached.
- When the turn has an authorized writable workspace, a durable ledger may be
  written there. When it does not, keep the same acceptance contract internally
  and state any verification that still needs a capable surface. Never claim a
  file or runnable check exists when the turn could not create or execute it.

## Define completion before execution

For substantial work, translate the request into a small set of observable
outcomes. Give each outcome one gate and identify the evidence that can decide
it. Prefer a runnable check that observes the artifact or behavior directly.
Use a manual gate only when no command or tool can decide the outcome.

A useful gate can fail honestly. It does not merely search for wording or print
its own expected value. For negative assertions, check that the same detector
fails on a known positive control. For supplied figures, measure them from the
source instead of copying the number into the expected result.

Do not silently delete a gate that becomes hard or impossible. Keep it unmet,
name the reason, and surface the handoff in the final answer.

## Finish the whole deliverable

Work through four passes when the task warrants them:

1. Produce the complete requested result without placeholders or a deferred
   remainder.
2. Re-read it as a domain expert and replace the cheap version of each part.
3. Hunt correctness, integration, portability, performance, and evidence
   defects, then fix what is found.
4. Apply low-cost polish and repeat until a full pass finds nothing material.

For delegated work, fix the leaf's outcome, dependencies, interfaces, and file
ownership before dispatch. Treat a worker's completion message as a handoff,
not proof. Inspect its artifacts and re-run the relevant checks in the parent
context before accepting it.

## Verify current evidence

Old output is not re-execution. Run the focused checks available to this turn
after the final change, and distinguish their observed output from checks that
were only reasoned about. A runnable gate passes only when its process or tool
succeeds and the decisive expected condition is present.

The current capability decision remains authoritative. This skill never grants
filesystem, shell, network, credential, connection, delegation, or mutation
authority. If the needed verification is outside the turn's permissions, leave
that gate visibly unmet rather than asking for broader authority or presenting
an assumption as evidence.

## Audit the final report

Immediately before answering, account for every requested outcome and every
gate. Lead with the actual result. Say what changed or was learned, what was
verified, and what remains unmet or abandoned. Never compose a finished-sounding
report while a required gate lacks current evidence.
