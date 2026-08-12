---
name: garden-research
version: 1.0.0
description: |
  Answer a question from the authorized garden's indexed knowledge using GBrain
  hybrid retrieval, with citations. Read-only: no writes, no coding, no admin.
category: knowledge
mode: knowledge
surfaces: [garden_chat, dashboard_terminal]
writes: false
triggers:
  - "what do we know about"
  - "search the garden"
  - "find in my notes"
  - "look up in the garden"
  - "background on"
---

# Garden research (Breadboard)

Retrieve grounded answers from the **authorized garden's** indexed knowledge and
answer with citations. This is GBrain garden knowledge — it is NOT conversation
memory. Conversation memory answers "what happened in this chat/project?"; GBrain
answers "what knowledge exists in the authorized garden sources?".

## Tools (read-only)
- `gbrain_status` — confirm GBrain is healthy/degraded before relying on it.
- `gbrain_search` — hybrid retrieval; returns excerpts + citations.
- `gbrain_retrieve` — fetch a specific page's full content by its citation page id.
- `gbrain_graph_neighbors` — related pages for a page.

## Procedure
1. Call `gbrain_status`. If unavailable, say so plainly and fall back to the
   Breadboard `garden_*` tools — never present un-grounded model knowledge as
   garden-grounded.
2. Call `gbrain_search` with the user's question. Narrow with `gardenId` only when
   the user names a specific authorized garden.
3. If a result needs its full context, `gbrain_retrieve` that page.
4. Answer concisely and **preserve every citation**. If retrieval ran in
   `lexical_degraded` mode, state that it was keyword-only.

## Boundaries
- Never propose or perform a write here. If the user wants to save something, hand
  off to **capture-to-garden** (which creates a Breadboard proposal).
- Never request arbitrary source ids, paths, or other gardens; scope is
  server-enforced.
