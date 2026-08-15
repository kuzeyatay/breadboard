# Goal Mode

Goal Mode integrates the cloned [goal](https://github.com/secemp9/goal) project
into Breadboard's Hermes conversations. It is an explicit mode in the
Intelligence menu, between Agent mode and Super agent.

Turning it on for a message creates (or resumes) one Goal-compatible
`goal_state.json` record for that conversation. The initial objective is the
message that enabled the mode. The record keeps Goal's upstream fields and is
stored under Breadboard's data directory, never in the user's checkout or in a
shared agent-home directory.

Every Goal Mode turn receives the cloned project's continuation template,
including its completion-audit rules. The agent can inspect or complete the
record via Breadboard's native `mcp_call` tool with the `goal` connection:

- `get_goal`
- `update_goal` with `{ "status": "complete" }`

`create_goal` is also protocol-compatible, but a mode-enabled conversation has
already created its goal and therefore returns Goal's normal existing-goal
error. This preserves the upstream one-goal-per-thread lifecycle.

Breadboard accounts a completed runtime turn after it is persisted. It only
records state for the exact goal id that was active when the turn started, so a
late completion cannot modify a different goal.

Goal Mode does not create unattended model turns. The user controls when the
next Breadboard turn runs; while Goal Mode is enabled, every such turn keeps the
same objective and completion standard. This matches Goal's MCP-only editor
mode while avoiding unbounded background model usage in Breadboard.

## Packaging

The desktop build stages Goal's continuation and budget-limit templates, MIT license, and source
revision under `app-services/goal/`. The Python stdio MCP server is not started
inside Breadboard because its process-level `GOAL_STATE_FILE` cannot safely be
shared across concurrent conversations. Breadboard provides the equivalent
three-tool protocol against conversation-scoped state instead.
