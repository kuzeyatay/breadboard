# New-note loading and metadata repair

The note `electromagnetism-1/fields-vectors-and-cartesian-coordinates-1790174177632`
was served from a persisted fallback shell containing an empty article and an
empty `.content-meta` row. The dashboard subsequently supplied its canonical
article, but that response had no reading or handwriting metadata. The
published content index did not contain this new note.

## Fix

- The canonical renderer now returns the same ContentMeta component used by
  published Quartz pages, computed from the current document's text before
  KaTeX expansion. It includes the normalized frontmatter modification date.
- The reader applies text, title, TOC, and metadata together. It retains a
  published filesystem date when no frontmatter date exists, and marks the
  metadata so an older asynchronously loaded index cannot overwrite it.
- A hard load requests its document at DOM readiness through the existing
  authenticated bridge, without waiting for the rest of the site to load.
  Bounded retries share one request ID; the host coalesces in-flight duplicates.
  A normal host refresh can satisfy that request as well.
- Reader controls remain available. The existing progress bar remains visible
  during loading, and actual failures offer an inline retry. SPA destinations
  receive their metadata before replacing the current page. A late response
  cannot populate an article that has since been replaced.
- The reader build synchronizes the static-service bridge with the same
  self-contained implementation used in new Quartz publications. Unchanged
  files are not rewritten. Older bridge installations cannot replace it.

## Live repair

Re-rendered the affected note into its existing derived public HTML, preserving
reader chrome, navigation, and the Markdown source. Backed up the old shell in
`dashboard/.tmp-note-metadata-repair/original-shell.html` and verified the source
did not change while rendering or writing.

The running reader returns HTTP 200 with the article and metadata already in
the response: 23 min read, 4,424 words, and approximately 3 hr 42 min to
handwrite. All 286 equations rendered without KaTeX errors.

## Activation

The live page repair needs only a reload. The general source changes require a
rebuild after closing the running app. `node scripts/build-quartz-reader.mjs`
currently reports EBUSY on `scripts/quartz-canonical-reader-bridge.mjs`, which
is locked by the running reader service. The app and active chats were not
restarted. For browser verification, a temporary Node loader redirected the
locked bridge's import to the exact source that the build will copy.

Focused syntax checks, ESLint on the host bridge and build script, and diff
whitespace checks pass. Browser tests cover both missing and existing metadata,
equation rendering, first visible paint, stale index responses, retry cleanup,
navigation, editing, and detached-article response races.

All 36 focused tests pass with file concurrency limited to one (Garden refresh,
document editor, fallback reader, document API, and folder metadata). An earlier
concurrent run timed out in the save visibility check; that check passed both
in isolation and in the final serial run.
