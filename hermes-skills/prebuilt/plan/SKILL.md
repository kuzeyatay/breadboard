---
name: plan
description: Read and keep the user's own board at /plan — projects, columns and cards, what is in progress, what is due, what is overdue. Use for "what's on my board", "what do I need to do", "anything late", "add a card for X", "move the visa thing to done", "make a note on OPS-12", "what am I in the middle of".
license: MIT
allowed-tools:
  - plan_list_projects
  - plan_board
  - plan_search_tasks
  - plan_upcoming
  - plan_get_task
  - plan_create_task
  - plan_update_task
  - plan_move_task
  - plan_comment_task
---

# Plan

The user's own board, the same projects and cards `/plan` draws. It is the
Kaneo model: a project holds columns, a column holds cards, and a card is a
piece of work. Nine tools — five reads and four writes.

breadboard:
  category: featured
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools:
    - plan_list_projects
    - plan_board
    - plan_search_tasks
    - plan_upcoming
    - plan_get_task
    - plan_create_task
    - plan_update_task
    - plan_move_task
    - plan_comment_task
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## You can keep the board, but you cannot destroy anything

Unlike the calendar, this is a surface you may write to: adding a card, editing
one, moving it between columns and leaving a note are all yours to do when the
user asks.

What is absent is absent on purpose. There is no tool that deletes a card, a
column or a project, and there is no way to archive one either. If the user
wants something gone, say plainly that you can move it but not delete it, and
that the card's own panel at `/plan` has a delete. Do not look for a way around
it — not a terminal command against the database, not emptying the card's title
to fake it.

Everything you *can* do is reversible with one drag, which is why you may do it
without asking first. That licence does not extend to volume: filing eleven
cards from one sentence of conversation is worse than filing none.

## Done is a column, not a flag

Landing a card in the board's final column — called **Done** unless the user
renamed it — is what marks the work complete, and moving it back out reopens it.
There is no separate status to set, and `plan_update_task` cannot mark anything
finished. Use `plan_move_task` with the column's name.

Columns are named, never numbered. Call `plan_board` or `plan_list_projects`
first if you are not certain what this project's columns are called; a board
does not have to use the default four.

## Refs are how a card is named

Cards are addressed by the ref the board shows — `OPS-12`, the project's slug
and the card's number. Every write tool takes one, and every read returns one.
Quote refs back to the user: they can see them on the board, so `OPS-12` is
something they can go and find, while a row id is not.

## Which read to reach for

`plan_upcoming` for "what do I need to do". It separates work that is already
overdue from work that is merely coming, which is the distinction the user
actually cares about, and it takes `days` rather than dates so you never have
to compute one.

`plan_board` for "what am I working on" — every column with the cards in it, in
board order. This is the shape of the user's own screen.

`plan_search_tasks` for finding a thing: text across titles and notes, or a
filter by priority or due window.

`plan_get_task` when a board entry is not enough — the notes in full, every
comment with who wrote it, the links to other cards.

`plan_list_projects` when you need a project's name, or when asked what they
have on generally. With a single project you can omit `project` everywhere.

## Writing well

Prefer one card that says the thing to three that circle it. A card's title is
a line the user will read on a board six weeks from now: "Chase the Berlin
visa appointment" not "Berlin" and not a paragraph.

Put what you know in `notes` rather than in the title — what you found, which
link, what the next step is.

Set `due` only when the user gave a date or the work genuinely has one. A board
where everything is due is a board with no due dates.

When you finish a piece of work in a conversation and it leaves a real
follow-up, filing it is usually right and worth mentioning in a clause: "I've
put a card on the board for the follow-up." When the user asked you to remember
something, filing it is the whole point, and it is what "remember this" should
mean rather than only saying you will.

`plan_comment_task` records what you did about a card, attributed to you. Use it
when the work happened in a turn the user will not reread — the next turn, or
the user next week, should be able to pick it up from the card alone.

## What the shapes mean

`filedBy` on a card says breadboard put it there rather than the user typing it:
`assistant` is you, `agent_run` is an `/agents:*` run, `schedule` is a scheduled
chat. The board shows this too. Do not present a card you filed as something the
user wrote down.

`priority` is one of `urgent`, `high`, `medium`, `low`. It is the user's
judgement, not yours — do not raise it because a card sounds important to you.

`done: true` means the card sits in a final column. Overdue counts never include
finished work, so a project with three overdue cards has three pieces of live
late work.

## Answering

Answer the question, then support it. "Two things are late: the visa and the
insurance renewal" beats the whole board rendered as a list.

Lead with overdue work when there is any — that is the answer to "what do I need
to do", and the rest is context.

An empty board or an empty result is a real answer and a good one. "Nothing is
overdue" is worth saying plainly rather than hedging about whether the query
worked.
