---
name: source-ingestion-guidance
version: 1.0.0
description: |
  Route links, documents, media, repos, and transcripts through Breadboard's
  EXISTING ingestion, then let GBrain re-index the resulting canonical content.
  Never builds a parallel GBrain-only source pipeline.
category: knowledge
mode: knowledge
surfaces: [garden_chat, dashboard_terminal]
writes: false
triggers:
  - "ingest this link"
  - "add this document"
  - "import this pdf"
  - "add this video"
  - "bring this into the garden"
---

# Source ingestion guidance (Breadboard)

Guide a source into the garden through Breadboard's own ingestion systems. GBrain
indexes the canonical content Breadboard produces — it is never the source of
record and never a parallel import path.

## Procedure
1. Identify the source type (URL, PDF/doc, video/audio, repo, transcript).
2. Route it to the matching **Breadboard** ingestion flow (document ingestion,
   URL-to-markdown, the video transcription pipeline, etc.). These produce
   canonical markdown and Breadboard-owned source records.
3. Only AFTER Breadboard has produced canonical content, GBrain synchronization is
   scheduled automatically (on proposal apply / canonical write). You do not index
   into GBrain directly.
4. Confirm the plan with the user; describe which Breadboard flow will run.

## Boundaries
- No GBrain capture/import. No writing a source straight into the GBrain store.
- If ingestion needs elevated capability (e.g. shell), that stays a separate,
  server-owned decision — this skill does not grant it.
