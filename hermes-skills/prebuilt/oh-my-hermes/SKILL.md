---
name: oh-my-hermes
description: Ask oh-my-hermes (OMH) which workflow an ambiguous or large request belongs to, who owns it, what the next action is, and what is not yet evidence. Use when the user asks to plan, scope, hand off, or route a piece of work, when they mention OMH or a workflow name like ulw-plan, ulw-work, ulw-research or omh-code-review, or when a request is big enough that starting to build it would be guessing.
license: MIT
allowed-tools:
  - omh_run
---

# oh-my-hermes

`omh_run` reaches the vendored oh-my-hermes clone: a deterministic local router
over 103 workflow contracts. It is not a model and not a service. Every answer
is computed from OMH's own catalogs on disk, so it is fast, repeatable, and
makes no network call of any kind.

breadboard:
  category: prebuilt
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools:
    - omh_run
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## What it is for

The router earns its place on requests where the shape of the work is the open
question — "help me ship this", "I want to add a feature safely", "research
this properly", "get this ready to hand off". Ask it, and you get back a named
workflow, the role that owns it, the concrete next action, a route plan, and an
explicit list of what has *not* happened yet.

It is the wrong tool for a request that is already unambiguous. If the user
asks what a function does, or to fix a typo, or to summarise a page, just do
that. Routing a small clear request through a workflow classifier wastes the
turn and produces a card nobody needed.

## Calling it

Pass argv items, no leading `omh`. The first item is the command:

- `["chat", "route", "<the user's request, verbatim>"]` — the main one. Give it
  the user's own words; the router reads intent from phrasing, and paraphrasing
  changes what it matches.
- `["recommend", "<task description>"]` — several candidate skills with scores,
  when you want options rather than one verdict.
- `["harness", "inspect", "<workflow>"]` — the evidence gates and phases a
  named workflow actually requires.
- `["cases", "list"]` — the worked G1–G10 operator scenarios.
- `["doctor"]` — install health. It exits non-zero when a check is blocking;
  that is a finding to report, not a failure to retry.

Add `--json` as its own array item for the machine-readable payload. Default to
the text card — the JSON for one route is tens of kilobytes and mostly
rendering metadata you will not use.

The router also accepts English, Korean, Japanese, Chinese, Spanish, French,
German, and Hindi without a translation step, so pass a non-English request
through unchanged.

## Reading the result back

Say what the route is and why, in your own sentence. Do not paste the card.
The parts worth carrying into the conversation are the workflow name, the next
action, and the boundary line — everything else is scaffolding.

The boundary matters more than it looks. OMH separates three states, and
collapsing them is the failure mode this whole layer exists to prevent:

- **Prepared** — a route, plan, or handoff is ready.
- **Observed** — something recorded that an action actually happened.
- **Verified** — a test, review, or check passed.

A route is *prepared*. It is not implementation, not a review, not CI, not a
merge. When OMH reports `prepared_not_observed`, that phrase means work has not
started. Never report a prepared route as though something ran.

## What it will not do

The Breadboard callback offers OMH's read-only surface only. Install, update,
memory writes, goal ledgers, loops, worktrees, and `coding fanout dispatch`
(which spawns local agent CLIs) are absent from the allowlist and will come
back denied. Do not look for a way around that — if the user wants OMH
installed against their own Hermes profile, that is a shell task they run
themselves, not something this tool does.

Its OMH and Hermes homes are pinned inside this conversation's workspace, so
`doctor` describes that sandbox rather than the user's real installation. Say
so if you report its output; otherwise the health check reads as a claim about
their machine.

## The workflows are also installable

The 103 OMH workflow skills are in the skills catalog under the **Workflow**
tab, each installable on its own through the normal review flow. If the user
keeps landing on the same route — `ulw-research`, say — installing that skill
gives them its full contract instead of a one-line recommendation. Mention it
once when the pattern is obvious; do not pitch it every turn.
