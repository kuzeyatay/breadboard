# Garden retrieval failure — 13 September 2026

Investigated conversation 444, “Mandatory lab attendance schedule,” in Telecom 1. The question selected `5xta0-study-guide-2026-2027-q1` and asked which labs were mandatory, when they started, and how often attendance was required.

## What happened

- Hermes made 29 model calls and 28 tool calls over about 9 minutes 47 seconds after its first recorded user message. Its session counters recorded 1,577,626 input tokens and 5,371 output tokens. These are runtime counters, not a billing calculation.
- Search and several subsequent reads hit the bridge's 45-second timeout. The assistant retried through other tools and performed two public web searches.
- Old paths from generated material did not match the current source path. The reader only compared exact bare slugs and paths ending in `.md`; paths supplied by search/Quartz could omit `.md` or include the Garden prefix.
- The fallback file listing produced 2,045,763 characters / 41,223 formatted lines. The assistant guessed offsets into the compressed result.
- The source reader truncated raw Markdown at 4,000 characters, spending much of that budget on frontmatter. It had no continuation offset or query window.
- The eventual answer said “2 times total,” citing the 5G timetable. It omitted the study guide's compulsory M2 MAC exercises. The source explicitly describes four individual M2 exercises and four M3 exercises; exercise counts and scheduled attendance dates must be distinguished.

## Reproduced bottleneck

Search rebuilt the retrieval index during the request. For each changed page, its FTS deletion filtered an **unindexed** `id` column, scanning the full corpus again. The same Telecom corpus (51,506 chunks) took 46.1 seconds to search in the isolated reproduction before the batching fix, and 5.1 seconds afterward. This reproduces a timeout cause; it does not attribute every second of the original chat to this one operation.

## Changes

- Delete affected FTS rowids in one transaction, with atomic rollback of base rows and search rows.
- Read source/page files directly and normalize Garden prefixes, URL encoding, fragments, and `.md` suffixes. Missing/ambiguous identifiers return exact alternatives, which the Python bridge now preserves.
- Return body text with query windows and continuation offsets.
- Filter and paginate file/folder results, retaining empty destination folders.
- Load current selected-document evidence before model dispatch. The original question now receives both the M2 attendance and M3 assessment passages directly, including relevant schedule text.
- Keep bulk embedding off interactive search requests and bound query embedding to three seconds, retaining lexical results if unavailable.
- Add explicit timeout recovery guidance so switching tool names does not lead to repeated calls to an unavailable service.

## Verification and activation

27 focused tests passed: 24 dashboard tests and 3 Python bridge tests. ESLint and the desktop TypeScript configuration passed. The broad default TypeScript invocation exhausted its default heap; the supported desktop configuration passed with an 8 GB ceiling.

The live study guide read completed in about 6 ms during direct verification. Search timing above excludes the approximately 2.2 seconds required to load the whole corpus asynchronously.

The running desktop serves a compiled standalone dashboard. Source changes require a rebuild and restart to activate. An EM 1 learning job was running at the activation check, so the restart choice was presented to the user. The original chat transcript was preserved.
