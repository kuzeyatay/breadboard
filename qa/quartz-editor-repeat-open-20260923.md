# Repeated Edit activation — 23 September 2026

An in-place canonical refresh could dispose and rebind the Edit button while its
first activation awaited the document API or IndexedDB. The button's local busy
flag disappeared with that binding. A second click started another mount before
the first had assigned `window.__quartzDocumentEditor`. Each mount appended its
own toolbar, tags, and Annotations button; the later mount replaced the first
editor surface but left its controls behind.

Editor initialization now shares a pending promise per article. Rebound controls
await the same operation. Document reads, recovery reads, and Markdown parsing
finish before adding UI. The operation checks that the original article and
document identity are still current, and rolls back controls, transport, and the
reader surface on failure. The public editor handle becomes available only once
initialization is complete. Repeated mode switches retain the same undo history.

Verification:

- The regression browser test reproduced two Annotations buttons before the fix;
  it now verifies exactly one toolbar, tag input, and Annotations button after a
  canonical refresh between two Edit clicks, followed by three Read/Edit cycles
  and undo.
- Browser checks cover constructor failure followed by retry and navigation away
  during the initial document read.
- All 16 editor browser checks and the scoped editor TypeScript check pass.
- Rebuilt editor JavaScript and CSS were installed into the running standalone
  dashboard with backup `.editor-mount-backup-1790170812568`. The served JavaScript
  hash matches the new build. All three open garden frames had no mounted editor
  or cached editor module, so their next Edit activation loads the fix without
  refreshing the page. Breadboard and Quartz were not restarted.
