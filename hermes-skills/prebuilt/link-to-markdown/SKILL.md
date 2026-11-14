---
name: link-to-markdown
description: Save a web page, article, documentation page or online PDF as a Markdown file from its URL. Use when someone pastes a link and asks to convert, save, export or clip it as Markdown or .md. For YouTube or other video links use video-to-markdown. Nothing is added to a Garden.
license: MIT
allowed-tools:
  - to_markdown
---

# Link to Markdown

Convert one URL into a Markdown file with `to_markdown`, using the same web
reader as Breadboard's Garden link import (page text plus its figures), and
attach the result to the reply.

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

1. Call `to_markdown` with `source` set to the URL exactly as the person gave
   it. One call per URL.
2. The Markdown file is attached to the reply. Reply in one or two sentences
   naming the page. Do not paste, summarize or rewrite its content.
3. A video link (YouTube, Vimeo, a direct .mp4) is transcribed instead of read
   as a page; that is expected.

## Failures

Report what the tool said. A page behind a login or a bot wall cannot be read
this way; say so instead of guessing at its content.
