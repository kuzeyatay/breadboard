---
name: goal
description: Hold one verified objective across every turn of this conversation until it is actually finished. Use when the user says to keep going until something is done, not to stop until it works, to work on something across several turns, or otherwise states a durable objective rather than a single request — "keep fixing this until the tests pass", "don't stop until the deploy is green", "your goal is to get this migrated".
license: MIT
allowed-tools:
  - mcp_call
---

# Goal

Most turns end when the answer is written. A goal does not. This skill binds one
objective to this conversation, carries it into every later turn whether or not
the user restates it, and refuses to call it finished on anything less than
evidence.

breadboard:
  category: featured
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools:
    - mcp_call
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## Create the goal first, in this turn

Before doing any of the work, record the objective:

    mcp_call connection="goal" tool="create_goal"
      args={ "objective": "<the objective in the user's own terms>" }

Write the objective as the finished state, not as the next action. "Every test
in dashboard/tests passes under npm test" is an objective. "Run the tests" is a
step toward one. If the user gave a bound — a number of turns, an attempt limit
— pass it as `turn_budget`; leave it out when they gave none rather than
inventing a ceiling they never asked for.

The objective is theirs. Keep their scope and their wording where you can. Do
not narrow it to the part you know how to do, and do not widen it into work they
did not ask for. If the request is genuinely ambiguous about what "done" means,
ask that one question first and create the goal from their answer.

One goal governs one conversation. If a goal already exists here, `create_goal`
refuses and that refusal is correct — read the existing one instead.

## Every later turn

The goal is injected into your context automatically from that point on; you do
not re-select this skill. When you need the current counters, read them:

    mcp_call connection="goal" tool="get_goal"

Then work the objective. A turn under a goal is not "answer what was just
asked" — it is "advance the objective, and answer what was just asked in the
course of it". When the user's message is unrelated, answer it, then say in one
line where the goal stands.

Never restate the objective back at the user every turn. They can see it above
the composer.

## Completion audit: finishing is a claim you have to earn

Only mark the goal complete after an audit against evidence you actually have
in this conversation:

- Name every requirement the objective states, including the implied ones.
- For each, name the specific thing that shows it is met — a command's output,
  a file that now exists, a test run, a page that loads. Not "I made the
  change"; the change is not the outcome.
- If any requirement has no such evidence, the goal is not complete. Say which
  one and what you would need.

Only when every requirement clears:

    mcp_call connection="goal" tool="update_goal" args={ "status": "complete" }

The response carries a budget report; relay it in one line so the user sees what
the goal cost.

`update_goal` marks completion and nothing else. Pausing, resuming and
abandoning belong to the user, through the goal card above the composer. Never
mark a goal complete to get out of hard work, and never mark it complete because
the user seems ready to move on — if they want it dropped, they will drop it.

## What a goal is not

It grants you nothing. Filesystem, network, shell, connections — every one of
them is decided by the normal capability decision for the turn, exactly as it
would be without a goal. A goal is a commitment about when you are allowed to
stop, not a widening of what you are allowed to do.

It also does not license running forever. When a turn budget is set and reached,
stop starting new work: report what is done, what is left, and the single next
step, and let the user decide.
