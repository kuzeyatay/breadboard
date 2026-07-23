---
name: frontmatter-guard
version: 1.0.0
description: |
  Validate Breadboard garden frontmatter/metadata against Breadboard's schema
  conventions; report errors or generate a revision PROPOSAL. Never edits directly.
category: knowledge
mode: knowledge
surfaces: [garden_chat, dashboard_terminal]
writes: false
triggers:
  - "check frontmatter"
  - "validate metadata"
  - "is this page's metadata valid"
  - "fix frontmatter"
---

# Frontmatter guard (Breadboard)

Validate a garden page's frontmatter/metadata against **Breadboard's** conventions
(not upstream GBrain's schema). Report problems or propose a fix.

## Tools
- `garden_get_page` — read the page + its metadata.
- `garden_run_proposal_validation` / `garden_propose_page_revision` — validate and
  propose corrections.

## Procedure
1. Read the page and inspect required Breadboard frontmatter fields (title, type,
   tags, source anchors, etc. as the garden uses them).
2. Report each issue: missing, malformed, or inconsistent field.
3. If a safe correction is clear, draft a **page-revision proposal** with only the
   frontmatter change and a rationale. Otherwise, report and ask.

## Boundaries
- Preserve Breadboard's schema conventions; do not import GBrain schema assumptions.
- No direct writes; no schema mutation.
