# Discovering sources from Garden chat

Garden chat can find external audio, videos, links and PDFs from a natural-language prompt.

- “Find three YouTube lectures about electromagnetic waves.” returns discoveries with source links.
- “Find two PDFs about transmission lines and upload them to this Garden.” searches, selects suitable results and starts document ingestion.
- “Collect audio, videos, articles and PDFs about Fourier transforms in this workspace.” discovers a mixed collection and imports suitable sources.
- “Find sources, but show me first; don't upload anything.” only searches. “Add those” in the next turn imports the selected earlier results.
- “Import https://example.org/lecture.mp3 into this Garden.” uses the supplied URL directly.
- Attach a PDF, Office document, text/Markdown file, PNG/JPEG/WebP image, audio, or video and say “Add this to my Garden.” Multiple files can be imported in the same prompt.
- “Add lecture.pdf from earlier in this chat to the Physics Garden.” imports the retained original without another upload.
- From the Terminal beside a signed-in Canvas page: “Download these PDFs into my Garden using AnyDoc+VLM.” imports the original files with both parsers enabled.

The assistant uses `garden_discover_sources` and `garden_import_source`. These are ordinary Garden tools and do not require Super Agent or a selected skill. Imports are restricted to Gardens owned by the signed-in user; public Quartz AI does not receive either tool.

For authenticated browser files, `browser_terminal` returns observed links (including direct download endpoints for Canvas file previews). `garden_import_source` accepts `useBrowserSession: true` with one exact link URL; the active conversation's linked tab supplies the Chromium session. The first request must stay on that tab's origin. Public HTTPS CDN redirects are supported without forwarding the source site's cookies. File bytes are bounded to 64 MiB and sent directly to ingestion, never to the model. Navigation, closed/revoked tabs, missing sign-in, preview/login HTML, interrupted streams and unsupported formats fail without queuing a source. Keep the source tab open; start the import from its adjacent Terminal.

Document imports accept optional `parseWithAnydoc` and `parseWithVlm` booleans for public PDFs, browser downloads and attachments. Both may be true for PDF visual parsing plus the AnyDoc text cross-check. Omitted values retain existing defaults. Duplicate-job lookup distinguishes requested parser settings, so a prior default PDF import cannot satisfy a later AnyDoc+VLM request.

For attached files, the import tool accepts `attachmentName` or a one-based `attachmentIndex` instead of `url`; the file type is inferred. Name selection can find earlier uploads in the same conversation, while indexes refer to the most recent upload message. Original bytes are resolved from the signed-in user's storage and processed by the existing document or transcription pipeline. Missing originals and unsupported formats return a clear error. Attaching or asking to summarize a file does not itself request a Garden import.

PDF discovery uses the existing Get Doc catalogs and open-access PDF URLs. Link, audio and video discovery use public web search. Video imports support individual YouTube videos and direct supported video files. Audio imports require a direct supported audio file; a player or podcast landing page without a download URL is reported as a discovery without claiming it was uploaded.

Links use the same conversion, image capture and source-writing service as manual link imports. PDFs enter Runtime V2 document ingestion; audio and video enter the existing transcription queue. Duplicate sources reuse the existing source or processing job. Queued jobs are reported as processing and the workspace refreshes when their source becomes available. Search/provider failures and individual import failures remain visible to the assistant for an accurate final report.
