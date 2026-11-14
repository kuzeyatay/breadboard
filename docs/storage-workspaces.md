# Workspace storage

The desktop's existing idle coordinator owns this work. It waits for two
minutes without user input, aborts when input resumes, and uses resumable
250 ms copy batches. A pending file gets another slice after one second;
ordinary maintenance keeps its fifteen-second cadence. Copy I/O is limited to
10 MiB/s, including writes. Windows filesystem compression and final locked
verification run in a cancellable child, with subsequent I/O charged against
the same budget; these individual native calls are not bandwidth limited.
The native helper uses an absolute Windows executable, normalized runtime
temporary paths and a small environment containing only OS prerequisites.
It does not inherit application credentials or Next's large configuration.

Only server-generated conversation directories below
`Data/runtime/hermes-workspaces` participate. A workspace needs seven days
without reads or writes, a known conversation owner, no pending messages,
active runs, unknown run states, or pending recovery operations. At least
2 GiB plus scratch space must remain before starting an input archive.
Unrecognized/custom directories, junctions, shared writable hardlinks, open
writers and alternate data streams are protected.

## Editable inputs

Cold `.breadboard/attachments` files are copied in bounded batches to a
SHA-256 object store under `Data/storage/workspace-objects`. Objects use native
NTFS compression when available. SQLite retains each logical path, timestamp,
object hash and allocated source bytes. Separate references share one object.

Before removing a source, a `synchronous=FULL` SQLite transaction persists its
recovery reference. Windows handles deny concurrent writes/deletion to both
copies. The helper rechecks identity, streams, length and SHA-256, and marks
only the verified source for deletion on close. New objects that would occupy
more allocated space than the original cannot replace it. A power loss or
interruption leaves the original, the durable object reference, or both.

Session creation, resume, turn submission, steering, editable-attachment
staging and authenticated internal tool requests restore inputs. Restoration
copies into a new private file, verifies it, flushes it and publishes without
overwriting an existing destination. It never hardlinks an editable document
to shared bytes. A changed destination keeps both versions as recovery data.
Full/damaged disks retain references and report a retryable failure.

Chat listing, search, transcript exports and page reads do not hydrate workspace
files. Large cold inputs may take time to restore when starting a run. This is
separate from cold transcript-page loading. Storage settings also offers an
installation-owner restore endpoint for opening old files outside a run.
Restoration remains available when automatic housekeeping is disabled.

## Other outputs

Text and simulation outputs use NTFS filesystem compression in place. Their
paths, identities, contents and independent write semantics remain unchanged;
native tools and existing previews require no archive reader. Videos, models,
executables, databases and unknown formats are retained unchanged. Platforms
without the exclusive Windows implementation skip automatic workspace
archiving rather than using an unsafe unlink fallback.

## Recovery and accounting

The object/temporary-file journal avoids a startup scan. Referenced objects
have no expiry. Only producer-journalled scratch and objects without any
archive or recovery reference expire after seven days. Recovery references
also prevent changed files from being re-archived over an older unique copy.
Unsettled references cannot be deleted, including when an original still
exists: a helper orphaned by a process crash could finish its deletion later.

Settings separates current input savings (original allocated bytes less all
retained object allocations) from cumulative bytes released by transparent
output compression. Pending/uncertain operations do not count as savings.
The regular inventory includes the object store exactly once. Both metrics
describe filesystem allocation, not reusable SQLite pages.

Validation: `node scripts/run-storage-tests.mjs` from `dashboard` includes
round trips, independent edits, disk-full and interrupted restoration, recent
reads, pending work/recovery, junction escape rejection, shared handles and
hardlinks, alternate streams, native compression, and deduplication.
