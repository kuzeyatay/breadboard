# Quartz long-document performance — 2026-09-19

Implemented server-side marking of prose blocks in articles with at least 80
top-level elements. The shared rendering helper covers static publication and
canonical document refresh. Screen CSS uses `content-visibility: auto` with
remembered block sizes; print rendering remains complete. Text and heading IDs
remain in the DOM for selection, search, and anchors.

Additional changes prune equation/widget subtrees from highlight indexing,
avoid indexing on unselected clicks and unannotated refreshes, normalize only
parents of removed marks, locate highlight spans with binary search, suppress
self-generated repaint mutations, cache TOC links, and ignore height-only
image-layout notifications.

## Verification

- 30 focused tests pass: 21 existing highlight/refresh/reader tests, 6 new
  long-document regressions, and 3 existing source-visual layout tests.
- Quartz TypeScript check passes.
- An isolated production Quartz build of the real Maxwell full-website Markdown
  and engineering electromagnetics textbook succeeds (one parser worker).
- Both built pages load without browser JavaScript errors. Viewport screenshots
  were inspected. Find, heading jumps, highlight re-anchoring, and print styles
  are covered by browser tests.

## Local measurements

Windows, headless Edge, 1440 × 1000 viewport, isolated two-page publication:

| Document | Article elements | Deferred blocks | Load + two frames | Scroll + two frames |
| --- | ---: | ---: | ---: | ---: |
| Maxwell full website | 3,619 | 714 | 661 ms | 28 ms |
| Electromagnetics textbook | 402,682 | 6,038 | 6,811 ms | 44 ms |

An earlier comparison of the textbook article with scripts removed measured
6,933 → 4,595 ms loading and 6,248 → 1,809 ms resizing when enabling the final
block styles. These are single local measurements, not a performance guarantee.
Off-origin requests were blocked and the isolated site has a small navigation
index; the running app's full garden index and dashboard refresh add work.
DOM parsing and memory still scale with document length.

The generated canonical renderer was rebuilt locally. No running app was
restarted and no user garden publication was replaced. Activation in the running
standalone app requires rebuilding its dashboard and republishing Quartz assets.
