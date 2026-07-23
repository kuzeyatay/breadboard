---
name: meeting-ingestion
version: 1.0.0
description: |
  Structure an already-authorized meeting transcript into proposed notes, people,
  decisions, and actions. Preserves the transcript as a Breadboard source; all
  derived notes are proposals.
category: knowledge
mode: knowledge
surfaces: [garden_chat, dashboard_terminal]
writes: false
triggers:
  - "process this meeting"
  - "summarize this transcript"
  - "extract decisions and actions"
  - "who was in this meeting"
---

# Meeting ingestion (Breadboard)

Turn an authorized meeting transcript into structured, reviewable notes. The
original transcript remains a Breadboard source; every derived note is a proposal.

## Procedure
1. Confirm the transcript is already an authorized Breadboard source (this skill
   does not fetch or import new media — see source-ingestion-guidance for that).
2. Extract: a concise summary, participants/people, decisions, and action items
   (owner + what + when where present).
3. For each derived artifact, create a Breadboard proposal
   (`garden_create_note_proposal`) with a rationale and evidence anchors pointing
   back to transcript locations. Do not overwrite the transcript.
4. Tell the user the proposals await their review/approval.

## Boundaries
- The transcript itself is preserved, never rewritten.
- No direct GBrain writes; approved proposals trigger GBrain re-index via
  Breadboard.
