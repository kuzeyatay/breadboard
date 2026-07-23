---
name: capture-to-garden
version: 1.0.0
description: |
  Turn "remember this" / "save this" / "make a note" into a Breadboard NOTE
  PROPOSAL the user reviews and applies. Never writes GBrain or markdown directly.
category: knowledge
mode: knowledge
surfaces: [garden_chat, dashboard_terminal]
writes: false
triggers:
  - "remember this"
  - "save this"
  - "make a note"
  - "turn this into a note"
  - "capture this"
---

# Capture to garden (Breadboard)

Convert a capture request into a **typed Breadboard proposal**. This never calls
GBrain capture and never edits canonical markdown. The user reviews and applies.

## Tools
- `garden_run_proposal_validation` — check whether a target page already exists.
- `garden_create_note_proposal` — propose a NEW note (does not publish).
- `garden_propose_page_revision` — propose a change to an existing page.

## Procedure
1. Decide: new note (no matching page) or revision (matching page). Use
   `garden_search` / `garden_run_proposal_validation` to check.
2. Draft the note markdown from the conversation content. Attach a clear rationale
   and any supporting evidence anchor ids.
3. Create the proposal with `garden_create_note_proposal` (or
   `garden_propose_page_revision`).
4. Tell the user a proposal was created and that **they must review and apply it**.
   On approval, Breadboard writes canonical markdown and schedules GBrain re-index.

## Boundaries
- Absolutely no direct GBrain capture/write, no markdown overwrite.
- Rejecting the proposal leaves both canonical content and the GBrain index
  unchanged.
