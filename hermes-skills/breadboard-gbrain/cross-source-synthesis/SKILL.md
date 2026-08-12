---
name: cross-source-synthesis
version: 1.0.0
description: |
  Compare several authorized garden sources: surface agreements, contradictions,
  changes over time, and knowledge gaps — with citations. Read-only.
category: knowledge
mode: knowledge
surfaces: [garden_chat, dashboard_terminal]
writes: false
triggers:
  - "compare these sources"
  - "do my notes agree"
  - "what contradicts"
  - "what changed over time"
  - "what's missing about"
---

# Cross-source synthesis (Breadboard)

Synthesize an answer across multiple **authorized** garden sources and highlight
agreements, contradictions, temporal changes, and gaps. Read-only.

## Tools
- `gbrain_synthesize` — extractive multi-source synthesis with citations.
- `gbrain_search` / `gbrain_retrieve` — to pull specific supporting passages.

## Procedure
1. `gbrain_status` first; report honestly if degraded/unavailable.
2. `gbrain_synthesize` the question. The synthesis is **extractive** — it never
   invents content and never substitutes un-grounded model knowledge.
3. Organize the answer as: points of agreement, contradictions (cite both sides),
   what changed over time, and explicit gaps ("no authorized source covers X").
4. Preserve all citations. Every claim must trace to a returned citation.

## Boundaries
- Contradiction/repair findings become **citation-audit** or garden proposals —
  never a direct write here.
- If synthesis returns no grounded material, say so; do not fabricate.
