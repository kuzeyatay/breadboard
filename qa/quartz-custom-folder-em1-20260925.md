# Custom folder navigation and retained Quartz publications

## Root cause

The running dashboard had been rebuilt on September 25, but the retained Quartz
`public/postscript.js` was still from September 24. Its Explorer treated a folder
absent from the published content index as a collapse control. EM1's saved
`introduction/_index.md` and three notes existed, but neither the folder nor its
notes appeared in the published index, and no folder HTML had been emitted.
Rebuilding only the dashboard therefore did not deliver the earlier Explorer fix.

Full document navigation also discarded the authoritative folder snapshot. The
custom folder reappeared only after another authenticated folder request; the
larger document inventory was requested concurrently with it. Clean folder links
could additionally be interpreted as a note with the same basename while awaiting
publication.

## Changes

- Build the actual Quartz ComponentResources emitter independently of notes.
  Web/desktop builds produce its shared assets; desktop development also refreshes
  them before launch. Desktop startup installs these app assets into retained
  publications, without modifying Markdown, HTML, or the content index.
- Restore the latest folder snapshot from tab storage before the first Explorer
  render, and refresh from the authenticated host. Cached folder operations wait
  for the host handshake so an early click is not lost before React hydrates.
- Link folders to their explicit `/index` identity, selecting the existing
  canonical folder renderer and standard graph, metadata, PDF export and listing.
- Fetch folders before the expensive document inventory and abort both stale
  requests when mutations invalidate them.

## Verification

- 21 focused dashboard regression tests passed: folder creation/copy/rename,
  mouse and keyboard navigation, same-named note collision, reload with the folder
  response held, retry, deletion, optimistic movement, and the real static service.
- Desktop asset upgrade regression passed: replaces obsolete scripts, preserves
  published HTML/index, avoids rewriting identical assets, repairs reverted
  assets, and rejects incomplete builds before modifying served files.
- Quartz type check and desktop test TypeScript compilation passed.
- Updated the running app's two changed JavaScript assets. HTTP reads from its
  active Quartz service matched all three freshly built asset hashes. The
  published content index hash was unchanged. No app restart or worker stop.
- An isolated browser embedded the **running Quartz service's actual EM1 HTML,
  CSS and scripts**, with a read-only local canonical bridge using EM1's actual
  Introduction Markdown. The folder opened with its three notes and standard
  graph in approximately 0.55 seconds, survived reload while folder snapshots
  were withheld, and produced no browser errors. The isolated bridge is not an
  end-to-end check of the signed-in dashboard session or its topology API.

The running dashboard's request-order optimization and automatic startup asset
refresh take effect on its next normal rebuild/restart. The Explorer/navigation
fixes have already been installed in the running Quartz service; an existing
Garden frame needs a reload to execute them.
