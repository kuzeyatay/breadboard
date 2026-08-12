# LoopX in Hermes

A Hermes conversation that turns into long-running work now carries durable
control state: an objective, owner gates, todos, a delivery record, and a quota
that decides what the next turn owes. That state is held by
[LoopX](https://github.com/huangruiteng/loopx), cloned at [`loopx/`](../loopx),
running as its real Python CLI rather than a reimplementation, because LoopX owns
the state transitions.

Nobody starts a loop. There is no command, no skill, and no toggle in the UI: a
conversation that is plainly long-running work picks up a goal on its own, and
every turn after that is composed against it.

## The shape of it

**The read path is a file read.** A LoopX command costs roughly 2.5 seconds off
OneDrive and closer to ten on it, which cannot sit in front of a turn. So the CLI
never runs while a turn is being built. Instead each tick writes a compact
projection to `snapshot.json`, and `composeHermesSystemPrompt` reads it
synchronously and renders a `loop_state` section. The section sits after the
capability record and before the turn's evidence, and it says plainly that it is
the state as of the end of the previous turn, which is the state that turn is
supposed to act on.

**The write path is the real CLI, after the fact.** When a turn finishes
streaming, [`conversation-tick.ts`](../dashboard/src/lib/loopx/conversation-tick.ts)
gathers what Breadboard observed and hands it to
[`tick.ts`](../dashboard/src/lib/loopx/tick.ts), which creates the goal if this is
the first qualifying turn, records the delivery, and refreshes the snapshot.
Nothing awaits it. A tick that fails is audited as `loopx.tick_failed` and leaves
the previous snapshot in place, because stale loop context beats none. Only one
tick per conversation runs at a time, and a second is dropped rather than queued,
so a fast exchange records fewer turns instead of building a backlog of Python
processes.

## When a conversation becomes a loop

[`decideEngagement`](../dashboard/src/lib/loopx/governance.ts) engages on the
first of these that holds, and Quartz is excluded entirely because its sessions
are page-scoped and can be anonymous:

| Signal | Why |
| --- | --- |
| The conversation already has a goal | Once governed, always governed |
| The capability decision is `scoped_implementation` | The server authorized real work |
| The request states a horizon past this turn | "keep working on X until it is done" |
| The conversation reached four user turns | Sustained work, whatever it is about |

The objective is the conversation's first request, not its generated title, which
can drift.

## What a turn is told, and what it owes

The rendered section carries the objective, LoopX's typed decision and the reason
for it, the obligation the work-lane contract puts on a delivering turn, the next
action on record, the open agent todos, the stop condition, and what LoopX counts
as delivery (a coherent artifact, targeted validation, and state writeback).

The branch that matters most is the gate. When LoopX reports an open owner gate,
the section stops asking for delivery and says the loop is waiting on a person:
do the work that does not depend on the gate, put the gate's question to the user
as one concrete decision, and stop. Do not decide it, and do not proceed as
though it were resolved.

Two things are suppressed on the way through. LoopX plans its own housekeeping as
agent todos ("Run `loopx check` against the project registry ..."), which would
contradict the rule that the assistant never runs `loopx`; those are dropped from
the projection, though LoopX still tracks them. And the section closes by stating
that it grants no capability, tool, or root, and is never to be mentioned in a
reply.

## How a turn is recorded

The delivery record comes from what Breadboard observed, never from what the
answer claimed about itself:

| Observed | Recorded |
| --- | --- |
| Completed, ran tools or produced an artifact | `delivered` / `bounded_segment` / `outcome_progress` |
| Completed, prose only | `delivered` / `single_surface` / `surface_only` |
| Errored or cancelled | `blocked` / `single_surface` / `outcome_gap` |

That distinction is what lets LoopX notice a loop that has stopped delivering.
Two prose-only turns in a row and its own lane guidance escalates to "do not
spend for another contract-only preparation layer", which is the control plane
working as designed.

The turn's prose is deliberately not copied into LoopX. It already lives in
Breadboard's conversation history, and duplicating it into control-plane files
would move private content for no control benefit.

## Containment

Upstream LoopX writes a project's state beside the project and a shared registry
under `~/.codex/loopx`. Breadboard does neither. Every invocation passes
`--registry`, `--runtime-root`, and `--project` inside a Breadboard-owned root,
and every mutating command passes `--no-global-sync`, so a conversation cannot
deposit control-plane state in the user's repository, Garden, or home directory.
[`loopxPaths()`](../dashboard/src/lib/loopx/runtime.ts) is the only place those
locations are decided, and a live test walks the whole tree afterwards to prove
nothing escaped.

Two more bounds. Only the read and tick surface of the CLI is reachable:
`bootstrap`, `status`, `quota`, `todo`, `refresh-state`, `diagnose`,
`evidence-log`, `version`. Nothing that installs, publishes, syncs to the shared
registry, projects into Lark, or launches another agent can be called. And the
free text that reaches durable state (the objective) is flattened to one line and
bounded, since it comes from a user message.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `ENABLE_LOOPX` | on | `0`, `false`, `off`, or `no` removes the tick and the section |
| `BREADBOARD_LOOPX_HOME` | `dashboard/loopx-goals` | Where the contained state lives |
| `BREADBOARD_LOOPX_ROOT` | sibling `loopx/` clone | The checkout to run |
| `BREADBOARD_LOOPX_PYTHON` | `hermes-agent/.venv`, then `chatmock/.venv` | Any Python 3.11+; LoopX has no third-party dependencies |

The desktop build stages `loopx/loopx` beside `hermes-agent` and points
`BREADBOARD_LOOPX_PYTHON` at the bundled CPython runtime.

## Tests

[`tests/loopx.test.mjs`](../dashboard/tests/loopx.test.mjs) covers containment,
the command allowlist, the engagement rule, the delivery mapping, the projection
and its schema guard, both rendered branches, and composition into the surfaces.
It runs in the default suite and spawns nothing.

[`tests/loopx-live.test.mjs`](../dashboard/tests/loopx-live.test.mjs) drives the
real CLI and is opt-in, because three ticks take about a minute:

```
BREADBOARD_TEST_LIVE_LOOPX=1 node --test --experimental-strip-types tests/loopx-live.test.mjs
```

## Known boundary

Breadboard does not yet create owner gates of its own. The gate branch is built,
rendered, and verified live, and it fires whenever LoopX's own state reports an
open gate; but every gate today comes from LoopX's planning rather than from
something Breadboard observed. The natural next step is a deterministic producer,
for example a turn whose requested outcome needed implementation the server did
not authorize, which is exactly "this needs the owner's decision". Policy denials
are not that: a denied command is a capability boundary, not a question for the
owner.
