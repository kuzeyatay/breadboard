# Garden content ownership

Independent folders such as `learning-copy`, `my-notes`, and renamed copies
belong to the reader. Learn metadata copied with a lesson does not transfer
ownership of that copy to Learn. Clearing or finalizing Learn must preserve
those folders and the visual artifacts they reference.

The copy contract applies to every garden and every visible folder, including
Sources, Concepts, and Artifacts. Copied frontmatter is ordinary `note` content;
ingestion, source-deletion, and artifact ownership move into `garden_copy_of`
provenance. Display metadata and citations remain readable. Copies are not new
Learn source inputs and are not deleted with an original source.
Copies of individual sections inside managed folders are placed at the garden
root, outside the generated tree. Nested user folders keep sibling copies.

Referenced local attachments (including original/searchable PDFs, recordings,
images, and document downloads) are copied into assets inside the destination
folder. Markdown, reference links, HTML media attributes, and attachment
frontmatter point to those owned files. Missing or symlinked dependencies abort
and remove the new folder. Renaming updates the local URLs; copying again makes
another independent set. PDF viewing, edits, and history resolve these nested
asset paths under the same garden boundary and use that garden's write lease.

Folder copies detach generated visualizers into `breadboard-detached-visual`
blocks. Each block owns a fresh visual ID and embeds its validated source,
compiled runtime, manifest, and publication evidence in the copied Markdown.
Rendering verifies the original hashes and gates, while the containing note
owns the snapshot independently of Learn's page, heading, and insertion anchor.
Deleting the original artifacts or renaming the copy does not break it. Copying
a snapshot again gives it another independent ID. Learn regeneration and
version-restore actions are absent from detached snapshots.

Copying fails atomically if a referenced visual is missing or invalid. Code
fences stay opaque to ordinary note-link rewrites, and embedded runtime bytes
are excluded from reading time, excerpts, and knowledge links. Older linked
visual references retain the original page authorization checks.

New planning and generation workers acquire a run lease with
`scope: "learn-output"`. It fences source inputs, generated output, and other
Learn operations while allowing authoring in independent folders. Hidden
directories, `learning`, `sources`, `concepts`, `internal`, asset directories,
and root Markdown documents retain exclusive protection. Root Markdown can
contain legacy source documents, so it has no concurrent editing exception.
The classifier is centralized in `dashboard/src/lib/garden-user-content.ts`.

Authoring declares its write paths and acquires a short content lease. Both
content and run admission use the same atomic transition guard. Saves cannot
overlap each other or the final publication swap. Source migration is disabled
during note saves; root and source navigation indexes are derived output.
Derived Quartz publication starts after the save lease is released.

Scoped generation excludes independent folders from its working candidate and
its source fingerprint. After candidate validation, publication acquires the
content lease, checks its run ownership and source fingerprint, and replaces
the candidate's entire user namespace with the current live namespace. This
preserves edits and additions and also propagates renames and deletions. It
then rebuilds navigation and swaps the garden. Visual dependencies from older
copies are retained without overwriting newly validated visual versions.

Rollback uses the same merge and swap. Recovery of an abandoned run under an
exclusive lease also carries forward the current user namespace before
restoring the previous generated output. A missing live tree or uncertain
ownership blocks ordinary saves rather than allowing recreation mid-recovery.
Short leases use process ownership and atomic JSON replacement so a dead save
worker can be recovered without releasing a still-running Learn worker.

Existing workers without a scope marker remain exclusive. Never add a scope
marker to a running old worker: it does not implement the publication merge.
Activate this change with a rebuilt dashboard and newly started workers after
the existing run finishes, or after deliberately stopping that run.

Behavioral tests:

```powershell
node --experimental-strip-types --test dashboard/tests/garden-detached-visual.test.mjs
node --experimental-strip-types --test dashboard/tests/garden-generated-folder-copy.test.mjs dashboard/tests/garden-folder-creation.test.mjs
node --experimental-strip-types --test dashboard/tests/garden-concurrent-learning.test.mjs dashboard/tests/garden-concurrent-authoring.test.mjs dashboard/tests/learn-clear.test.mjs
node --experimental-strip-types --test --test-name-pattern 'finalization and validation preserve' dashboard/tests/garden-finalize.test.mjs
```
