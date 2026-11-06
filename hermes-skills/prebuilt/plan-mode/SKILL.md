---
name: plan-mode
description: Plan the requested work before taking action. Use when the user selects Plan mode in the chat composer or explicitly invokes /plan-mode.
license: MIT
---

# Plan mode

breadboard:
  category: reviewed-guidance
  surfaces: [dashboard_terminal, garden_chat, quartz_ai]
  requiredTools: []
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

The user has selected planning for this message. Understand the requested result,
inspect relevant information through read-only tools, and ask focused questions
only where an answer changes the plan. Present a concrete, ordered plan with the
important decisions, dependencies and verification steps appropriate to the task.

Do not execute the plan, edit user files or records, send messages, launch work,
create a persistent goal, or change the user's task board during this turn.
Finish with the proposed plan for the user to review. A later explicit request
to implement or execute the plan authorizes action; selecting this mode again
continues planning. This mode is distinct from the /plan task-board capability.
