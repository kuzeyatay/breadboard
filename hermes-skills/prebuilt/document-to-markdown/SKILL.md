---
name: document-to-markdown
description: Convert a document attached to the chat (PDF, scanned PDF, Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV or text) into a Markdown file. Use when someone asks to turn, convert, export or extract a document as Markdown or .md. Not for summarizing or studying it, and nothing is added to a Garden.
license: MIT
allowed-tools:
  - to_markdown
---

# Document to Markdown

Convert one attached document into a Markdown file with `to_markdown` and
attach the result to the reply. The conversion is the same reader Breadboard
uses for uploads: AnyDoc for office formats, the text layer for PDFs, and for
a scanned page the model selected in this chat reads the page image.

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

1. Call `to_markdown` once per document with `source` set to the exact
   attached filename. Add `title` only if the person named one.
2. The Markdown file is attached to the reply as an artifact. Reply with one
   or two sentences: what was converted and how (`method`). Do not paste the
   Markdown back into the chat, summarize it, or rewrite it.
3. If several documents are attached and the person asked for all of them,
   convert each one separately.

## Failures

Say what the tool reported in plain words. A scanned PDF that fails OCR is
usually the selected model refusing or not supporting images: suggest
switching to a vision-capable model in the chat's model picker.
