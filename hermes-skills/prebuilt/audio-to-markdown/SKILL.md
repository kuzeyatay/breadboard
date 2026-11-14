---
name: audio-to-markdown
description: Transcribe an audio file attached to the chat (mp3, wav, flac, ogg, m4a, aac) into a timestamped Markdown file, locally with Whisper. Use when someone asks to transcribe a recording, voice memo, lecture, podcast or meeting into Markdown, text or .md. Not for musical analysis (use audio-analysis). Nothing is added to a Garden.
license: MIT
allowed-tools:
  - to_markdown
---

# Audio to Markdown

Transcribe one attached recording into a timestamped Markdown file with
`to_markdown` and attach it to the reply. Speech is recognized on this machine
by the local Whisper engine; nothing is uploaded.

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - to_markdown
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## Workflow

1. Call `to_markdown` with `source` set to the exact attached filename.
2. A long recording takes minutes. Wait for the result; do not call again for
   the same file while it runs.
3. The Markdown file is attached to the reply. Reply in one or two sentences.
   Do not paste, summarize or clean up the transcript.

## Failures

Report what the tool said. If the local transcription engine is missing, tell
the person to build it once from the Video Use agent's settings.
