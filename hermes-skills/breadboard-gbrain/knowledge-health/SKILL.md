---
name: knowledge-health
version: 1.0.0
description: |
  Report GBrain index health: configured/degraded/unavailable, stale gardens,
  failed sync jobs, missing embeddings, and degraded retrieval. Read-only; no
  autonomous repair, no cron.
category: knowledge
mode: knowledge
surfaces: [garden_chat, dashboard_terminal]
writes: false
triggers:
  - "is the knowledge index healthy"
  - "gbrain status"
  - "why is retrieval degraded"
  - "which gardens are stale"
  - "check sync"
---

# Knowledge health (Breadboard)

Report the health of the derived GBrain knowledge index. Read-only and diagnostic:
no destructive repair, no cron creation, no autonomous fixes.

## Tools
- `gbrain_status` — configured/healthy/degraded/unavailable/disabled + mode.

## Procedure
1. Call `gbrain_status`. Translate the result plainly:
   - `disabled` — GBrain is off for this deployment.
   - `unavailable` — adapter not reachable; no retrieval possible right now.
   - `degraded` — running `lexical_degraded` (no embeddings); keyword-only.
   - `healthy` — hybrid retrieval available.
2. If the user is a garden owner and asks about a specific garden, point them to
   the Breadboard GBrain status panel / `POST /api/gbrain/sync` retry action for
   stale sources — do not trigger destructive repair yourself.
3. Distinguish *unavailable* from *disabled* from *not configured*.

## Boundaries
- No autonomous re-index or repair; the owner triggers sync through Breadboard.
- Never expose secrets, adapter URLs, absolute paths, or internal source ids.
