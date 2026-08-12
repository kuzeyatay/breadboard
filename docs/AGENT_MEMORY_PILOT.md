# Cross-agent memory: the read-side pilot

Garden Chat and the Terminal have always had durable memory. The ~30 wrapped
external agents (`/agents:*`) never have — each one starts every run knowing
nothing about the person who asked. This is the first half of closing that gap,
scoped deliberately small so that a week of real use can decide whether the rest
is worth building.

It exists because an evaluation of TencentDB-Agent-Memory concluded that
integrating a memory hub would not close this gap: the per-agent seam work is
Breadboard-specific either way, so the hub would have added a second canonical
store and three Docker services on the hot path without removing any of the
work. See `council-transcript-2026-08-10-1309.md` in the repo root.

## What it does

Before an enrolled agent's run starts, Breadboard selects durable memories
against the task text and renders them into a short block the runtime receives
as background. Nothing is written back: agent-authored memory needs a review
gate that does not exist yet, and without one a single prompt-injected run would
gain durable influence over every future run of every agent.

Implementation: `dashboard/src/lib/conversations/agent-memory-context.ts`.
Tests: `dashboard/tests/agent-memory-injection.test.mjs`.

## Enrolled agents and their seams

| Agent | How the block reaches the runtime |
| --- | --- |
| `legal_agent` | Its own section of the system prompt, appended in `scripts/legal-bridge.py` (`_system_prompt`). Never the assignment — the assignment is the brief. |
| `deep_research` | A `userContext` field beside the query, carried into `systemPrompt()` in the engine. Not inside the query, which the engine embeds in a `<prompt>` tag to generate search terms. |
| `stock_analyst` | Prefixed to the message at the HTTP boundary. That backend takes a single string, so `run.task` stays the user's own words for the card, the label and the saved message. |

TradingAgents is deliberately absent. It has no free-text input anywhere in its
graph, and its one text slot (`past_context`) reaches only the portfolio manager
and means "lessons from prior trades". Stock Analyst represents markets instead.

## What may cross the boundary

Selection policy is `conversations/memory.ts` unchanged — same scores, same
cutoff, same hybrid channel. A memory that would not have reached a chat turn
does not reach an agent either. Four extra rules apply because the reader is a
foreign process rather than Breadboard's own turn:

1. **Confirmed only.** A candidate is an unreviewed guess, and guesses stay in
   the app that can show them to the user beside a "forget" button.
2. **Global scope only.** A project- or garden-scoped memory is about a place,
   and an external runtime is not in that place. Down-weighting was not enough:
   the weakest scope weight still clears the cutoff on a strong lexical match.
3. **Sensitive rows are dropped, not redacted.** In-app, `[sensitive content
   omitted]` is honest bookkeeping. Here it would still disclose that such a
   memory exists, to a runtime that logs its own prompts and calls external APIs.
4. **Bounded.** At most 5 memories, 320 characters each, 1,800 for the block, so
   an injected block can never crowd out the task it accompanies.

The block's header states that it is context and not instruction, that it grants
no authority, and that the task wins where the two conflict. That framing is
load-bearing and is asserted by a test: memory is user-authored text arriving
where instructions normally live.

## Reading the evidence

Every attempt appends one JSON line to `dashboard/db/agent-memory-injection.jsonl`
(gitignored), whether it injected or not.

```
{"at":"…","agent":"legal_agent","injected":true,"memoryCount":1,"memoryIds":[2],
 "characters":470,"channel":"lexical","withheldSensitive":1,"elapsedMs":3,
 "selection":{"ranked":2,"droppedUnconfirmed":0,"droppedScope":0,
              "droppedSensitive":1,"droppedOverLimit":0}}
```

`selection` is what makes the log worth keeping. Without it a run starved by the
filters looks identical to a run where the user simply had no relevant memory —
and telling those apart is the difference between "cross-agent memory did not
help" and "cross-agent memory never actually ran".

Read it against runs you actually judged:

- `injected` mostly `false` with `selection.ranked: 0` — nothing relevant
  existed. The gap may be smaller than it looked.
- `injected` mostly `false` with `ranked` high and `droppedScope` high — memory
  exists but is saved at project scope. The scope rule, not the idea, is what
  needs revisiting.
- `injected: true` and the runs read better — extend to more agents, then build
  the review gate the write side needs.
- `injected: true` and the runs read the same or worse — stop. Inspect
  `memoryIds` against Settings → Memory to see what was actually sent.

## Switches

- `BREADBOARD_AGENT_MEMORY=off` — stops every injection. The kill switch.
- `BREADBOARD_AGENT_MEMORY_AGENTS=a,b` — overrides the enrolled set without
  touching code.

Both default to "on for the three enrolled agents": a pilot only produces data
if it runs.

## Known limits

- The lexical channel alone is narrow. "Prefers plain English over legalese"
  shares no words with "review the shareholder agreement", so only the semantic
  (mem0) channel relates them. With `BREADBOARD_MEM0=off` expect thin results,
  and read `channel` in the log before concluding anything.
- Injection happens at run start only. Long runs cannot retrieve mid-run; the
  ChatMock gateway is the natural place for that and is not wired to memory.
- Nothing is written back. Run outputs do not become memory.
