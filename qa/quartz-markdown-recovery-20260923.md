# Quartz Markdown overwrite and source-figure routing

The Markdown rewrite endpoint parsed an empty `content` response, then fell
through to saving the entire JSON envelope as Markdown. This erased the body
and title metadata while reporting success. Requests for figures were routed
to that endpoint, whose model had no Garden search or figure tools.

The endpoint now requires a valid JSON edit with nonempty content, rejects
refusals and unfinished completions, and rejects missing original frontmatter
or title. Invalid responses return an error without writing, reindexing, or
publishing. Successful edits retain a content-addressed copy of the previous
file in `.breadboard/markdown-edit-history` before either save path runs.

Figure requests now use the Garden agent. Both Garden and Quartz instructions
require searching related sources, notes, and lessons, inspecting the existing
Learn source-visual catalog and Markdown images, and proposing targeted
insertions with verified image paths and attribution. Relative Markdown image
links are resolved against their source page so they remain valid when reused
in another note.

## Recovery

Restored `electromagnetism-1/fields-vectors-and-cartesian-coordinates-1790174177632.md`
in the desktop's live Quartz content directory. The full body came from the
three recorded reads in conversation message 29323270, checked against the
later read in message 29323272, followed by applied proposals 14 and 13. This
retains the Cartesian-product addition and both basis-vector edits. Original
frontmatter was verified against the SHA-256 recorded by the earlier metadata
repair. Restored SHA-256:

`5c58cd28fe17073b11cf23d20657717164d7f1aa0a7ecdda00f57ee7e2b0d46c`

Recovered and corrupted copies are retained under
`%APPDATA%/breadboard-desktop/Data/recovery/markdown-20260923`.
Investigation evidence and prior derived files are retained under
`dashboard/.tmp-markdown-recovery-20260923`.

The canonical file, derived HTML, search index, and explorer metadata are
restored. The live static service returned HTTP 200 with the restored title
and body. Rendering produced 4,615 words, 308 equations, and zero KaTeX errors.

## Verification and activation

34 focused tests passed across Markdown edits, figure retrieval, authorized
Garden reads, scoped revisions, and Quartz support. ESLint passed for the save
route and source-figure helper; diff whitespace checks passed. Live read-only
figure retrieval found available vector-addition and Cartesian-component
figures in EM 1's engineering-electromagnetics source.

The desktop rebuild was blocked by its Windows commit-memory admission check:
16,979 MB available, versus an 11,321 MB reserve plus an 11,264 MB build estimate.
The running app was not restarted. The note recovery is live; compiled code
changes need a successful rebuild and restart before they protect new edits.
