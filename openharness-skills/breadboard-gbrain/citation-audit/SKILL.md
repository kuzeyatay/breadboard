---
name: citation-audit
version: 1.0.0
description: |
  Inspect citation completeness across authorized garden pages and suggest repairs
  as page-revision PROPOSALS. Never edits markdown directly.
category: knowledge
mode: knowledge
surfaces: [garden_chat, dashboard_terminal]
writes: false
triggers:
  - "audit citations"
  - "check sources on this page"
  - "are these claims cited"
  - "fix missing citations"
---

# Citation audit (Breadboard)

Check whether claims in authorized garden pages are backed by citations and
propose repairs. Repairs are **page-revision proposals**, never direct edits.

## Tools
- `gbrain_search` / `gbrain_retrieve` — read the page + candidate supporting sources.
- `garden_get_page` / `garden_get_page_context` — Breadboard page + anchors.
- `garden_propose_page_revision` — propose the citation fix.

## Procedure
1. Retrieve the target page and its claims.
2. For each uncited or weakly-cited claim, search for a supporting authorized
   source. Record whether support exists, is weak, or is absent.
3. Where support exists, draft a **page-revision proposal** adding the citation.
   Where support is absent, flag it for the user rather than fabricating one.
4. Summarize: cited / weak / missing, plus any proposals created.

## Boundaries
- No direct markdown edits, no GBrain citation-repair writes.
- Never invent a citation to satisfy the audit.
