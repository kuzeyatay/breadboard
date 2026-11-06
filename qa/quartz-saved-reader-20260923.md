# Saved note titles and first display — 23 September 2026

The editor saved titles correctly, but Explorer only used canonical document
metadata for entries missing from its published index. Published entries retained
their old titles. Canonical article refresh also skipped metadata updates when
the rendered body was unchanged.

Explorer now uses saved titles for existing entries and retains acknowledged title
changes through tree rebuilds. Editor save acknowledgements update the breadcrumb,
Explorer link, and document title without modifying the editor's heading or cursor.

Previously SPA navigation morphed old published HTML into the page, then the host
fetched and replaced it with saved Markdown. The head-loaded canonical reader now
prepares the destination through the authenticated document bridge before the
router morphs it. The current page remains usable during that request. Failed
requests retain it and offer Retry. On hard loads, obsolete article text, title,
and table of contents remain hidden until the canonical response arrives; normal
reader controls and the existing top progress bar remain available. Opening the
editor during that request reveals its current draft without replacing it.

The versioned reader also handles the legacy static-service shim already injected
into old publications. Source, origin, document, session, and request validation
remain in place. Markdown paths are unchanged; renaming the title keeps links valid.

## Verification

- 13 garden-host browser checks pass, including frame-by-frame paint sampling
  with intentionally stale publications and delayed API reads in both garden
  views. No published text or obsolete title paints on reopen. These also cover
  title-only refreshes preserving article nodes, retry after navigation failure,
  and editing during a slow initial read.
- Explorer's browser check covers renamed published entries, newly created
  entries, subsequent tree rebuilds, mouse navigation, and keyboard navigation.
- All 13 editor browser checks and the page export browser check pass, covering
  autosave, recovery, conflicts, undo, annotations, IME, embeds, and exports.
- Quartz TypeScript checking and an isolated CLI publication build succeed.

## Running installation

Rebuilt prescript/postscript and editor assets were installed with backups in
`Data/quartz/.saved-reader-backup-1790170239209`. The shared dashboard bridge's two
served chunk copies received the same syntax-checked optional `render=1` GET
change as the source. Corresponding Quartz template files were synchronized so
subsequent publication retains the fix.

Only idle garden pages with no mounted editor, detected whiteboard, active
assistant run, or text draft were refreshed. EM 1, EC 2, and Telecom loaded reader
version 2, current titles/breadcrumbs and folder links, and successfully prepared
the current saved document through the authenticated bridge. No browser exceptions
were observed. No Markdown documents were changed during live verification.
Neither Breadboard nor its dashboard or Quartz service was restarted.
