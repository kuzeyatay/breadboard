# Goal

Goal integrates the cloned [goal](https://github.com/secemp9/goal) project into
Breadboard's Hermes conversations. It is a first-party skill — `hermes-skills/prebuilt/goal`
— not a switch. It used to be a third toggle in the Intelligence menu, between
Agent mode and Super agent; that switch is gone, because the sentence that most
needs a goal ("keep going until the tests pass") is exactly the one people type
without opening a menu first.

## Starting a goal

The skill is selected the way every other first-party skill is: by typing
`/goal`, or from the wording of the message. `src/lib/hermes/goal-intent.ts`
fires on a commitment to keep working past this turn ("don't stop until…",
"iterate until it's green"), on an objective named as one ("your goal is to…",
"Goal: …"), and on an open-ended bound ("however long it takes"). It runs last
in the selection chain, so a turn another skill already claimed on its own
subject keeps it — a conversation carries at most one skill, and a video or a
diagram is the subject of its turn while a goal is a commitment about it. It
never fires on a conversation that already holds a goal, or on a message that
discusses goals rather than setting one.

On that turn the model writes the objective itself, with `create_goal`, so the
recorded objective is the finished state rather than whatever text happened to
be in the box. From then on the goal is carried by its own system section on
every turn of that conversation, with no skill involved.

The record keeps Goal's upstream `goal_state.json` fields and is stored under
Breadboard's data directory, keyed by a hash of the conversation id — never in
the user's checkout or in a shared agent-home directory.

## The turn contract

Every turn under a goal receives the cloned project's continuation template,
including its completion-audit rules. The agent reaches the record through
Breadboard's native `mcp_call` tool with the `goal` connection:

- `create_goal` — only on the turn the skill was selected for; a conversation
  that already holds a goal gets Goal's normal existing-goal error, which
  preserves the upstream one-goal-per-thread lifecycle.
- `get_goal`
- `update_goal` with `{ "status": "complete" }`

Completion is the model's only transition, and it has to be earned: the skill's
guidance requires naming each requirement in the objective and the specific
evidence that meets it before `update_goal` may be called.

Breadboard accounts a completed runtime turn after it is persisted. The run
carries the goal id it was dispatched with, so a late completion cannot modify a
different goal; on the turn that creates the goal there is no id yet, and
`event-stream.ts` resolves it from the conversation's state at finalize so the
first turn is accounted like every other one.

## The goal card

While a conversation holds a goal, `src/app/components/hermes/goal-card.tsx`
sits at the top of the composer on all four chat surfaces. It shows the status,
the objective, a live clock since the goal was set, and the turn counter against
its budget. The five readings are: running (a turn is in flight), stalled
(active but idle), paused, out of turns, and complete.

Pause, resume, extend and abandon live there and nowhere else — they are the
person's half of the contract, served by
`/api/hermes/sessions/[sessionId]/goal`. The card's play button on a stalled
goal sends one continuation message; Goal still creates no unattended model
turns, and the user controls when the next Breadboard turn runs.

## Packaging

The desktop build stages Goal's continuation and budget-limit templates, MIT
license, and source revision under `app-services/goal/`. The Python stdio MCP
server is not started inside Breadboard because its process-level
`GOAL_STATE_FILE` cannot safely be shared across concurrent conversations.
Breadboard provides the equivalent three-tool protocol against
conversation-scoped state instead.
