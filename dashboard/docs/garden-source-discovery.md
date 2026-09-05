# Discovering sources from Garden chat

Garden chat can find external audio, videos, links and PDFs from a natural-language prompt.

- “Find three YouTube lectures about electromagnetic waves.” returns discoveries with source links.
- “Find two PDFs about transmission lines and upload them to this Garden.” searches, selects suitable results and starts document ingestion.
- “Collect audio, videos, articles and PDFs about Fourier transforms in this workspace.” discovers a mixed collection and imports suitable sources.
- “Find sources, but show me first; don't upload anything.” only searches. “Add those” in the next turn imports the selected earlier results.
- “Import https://example.org/lecture.mp3 into this Garden.” uses the supplied URL directly.

The assistant uses `garden_discover_sources` and `garden_import_source`. These are ordinary Garden tools and do not require Super Agent or a selected skill. Imports are restricted to Gardens owned by the signed-in user; public Quartz AI does not receive either tool.

PDF discovery uses the existing Get Doc catalogs and open-access PDF URLs. Link, audio and video discovery use public web search. Video imports support individual YouTube videos and direct supported video files. Audio imports require a direct supported audio file; a player or podcast landing page without a download URL is reported as a discovery without claiming it was uploaded.

Links use the same conversion, image capture and source-writing service as manual link imports. PDFs enter Runtime V2 document ingestion; audio and video enter the existing transcription queue. Duplicate sources reuse the existing source or processing job. Queued jobs are reported as processing and the workspace refreshes when their source becomes available. Search/provider failures and individual import failures remain visible to the assistant for an accurate final report.
