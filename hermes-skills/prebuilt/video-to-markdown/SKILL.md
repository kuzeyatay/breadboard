---
name: video-to-markdown
description: Turn a video into a Markdown transcript file, from a YouTube link, another video link (Vimeo, TikTok, a direct .mp4) or a video attached to the chat. Use when someone asks for a video's transcript, captions or text as Markdown or .md. Not for answering questions about a video (use watch). Nothing is added to a Garden.
license: MIT
allowed-tools:
  - to_markdown
---

# Video to Markdown

Produce a timestamped Markdown transcript of one video with `to_markdown` and
attach it to the reply. Links use the video's own captions when it has them
and fall back to Whisper; an attached video is transcribed locally.

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

1. Call `to_markdown` with `source` set to the link exactly as given, or the
   exact filename of the attached video.
2. Transcription can take minutes for a long video. Wait for the result; do
   not call the tool again for the same video while it runs.
3. The Markdown file is attached to the reply. Reply in one or two sentences.
   Do not paste, summarize or clean up the transcript.

## Failures

Report what the tool said. If the local transcription engine is missing, tell
the person to build it once from the Video Use agent's settings.
