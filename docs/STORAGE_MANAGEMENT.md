# Storage management

Breadboard keeps its current data root. No storage migration to another drive is
performed. Housekeeping is enabled by default; disabling it never disables the
readers for compressed messages or deduplicated PDF revisions.

## Ownership and scheduling

The Electron lifecycle owns one 15-second polling timer. It starts a batch only
after two minutes without input, aborts requests when input resumes, and never
creates a runtime job for maintenance. The dashboard also checks foreground
messages, asks the native runtime to check its own jobs, and takes a short-lived
exclusion lease. Work is split into short slices, with compression and file
hashing throttled initially to 10 MiB/s. Different phases take turns so a large
file cannot permanently starve accounting.

`GET /api/storage`, `PATCH /api/storage` (`automatic: boolean`) and
`POST /api/storage/maintenance` (`action: tick | clean | scan | compact`) require
the authenticated installation owner. Requests accept no filesystem paths.
`compact` queues a separate idle maintenance window; it does not compact a live
database in an HTTP request.

## What can be discarded

* Native runtime schema 14 classifies scheduled no-ops by exact, operation-specific
  zero-work result contracts, a confirmed process-tree exit, and a verified result
  digest. It removes only their known input/result files and empty workspaces after
  24 hours. Unknown files, outputs, checkpoints and unrecognized results survive.
* Seven-day-old proven no-op history is replaced by a schedule watermark and daily
  count in the same transaction. An older unsettled occurrence blocks advancement.
  Expired keys cannot create new jobs; ordinary user-job idempotency stays intact.
  Counters expire after 365 days.
* Heartbeat and progress diagnostics for settled scheduler failures expire after
  30 days. Failure outcomes, recovery evidence and uncertain operations survive.
* Desktop diagnostic logs have ten-day retention and an installation-wide 250 MiB
  cap within the owned log directory. Shared or redirected files are skipped.
* Rendering scratch directories carry producer receipts. Released or abandoned
  scratch can be removed after seven days; active processes remain protected.
  Verified, completed VS Code installer archives also carry release receipts.
* Other producers can use `releaseDisposableFile` and `leaseDisposableFile`.
  Cleanup journals a private quarantine path, then verifies the renamed file's
  identity before unlinking it. A concurrent replacement is restored or retained
  in the journalled quarantine. An interrupted sweep can safely resume.
* A failed lesson workspace is not disposable because it is old or exceeds a count
  limit. Supersession requires an exact surviving copy, no active descendant lease,
  and the existing checkpoint/receipt checks. Large or ambiguous trees are retained.

Legacy temporary directories and unregistered downloads do not acquire deletion
authority from a scan. The old opportunistic sweeps that inspected only 2,000 recent messages are
disabled; unsent uploads also remain protected. User downloads, chats, recordings, attachments, model files,
unique workspace files and recoverable drafts are retained.

## Lossless chat storage

`conversation_messages` remains the indexed hot projection. Searchable message
text, IDs, ordering, timestamps, tokens and queried metadata remain directly
accessible. The `conversation_message_reads` view restores original metadata and
sources through a shared SQLite function. Full-payload readers use this view;
indexed predicates resolve message IDs on the hot table before hydration. JSON
patch writers first read the complete original value.

A conversation must have no read or write for seven days, no pending message,
active run or recovery request. Reads are recorded independently of compression.
The asynchronous worker rechecks eligibility and compares the original field at
commit, so edits during a compression slice cannot be overwritten.

Payloads use the versioned `BBZ1` frame format, Zstandard level 3, SHA-256, and
independent frames no larger than 4 MiB. Migration uses smaller 256 KiB frames
for responsiveness. Each frame is recovered and compared before committing the
replacement. Values under 16 KiB, savings under 10%, and values above the current
64 MiB working bound stay plain. The decoded-text LRU is capped at 64 MiB.
Appending a message does not restore the conversation. Deletion cascades through
the payload table; field replacement invalidates its old compressed copy.

Hermes's native searchable session database and its resume inputs are unchanged.
This feature neither summarizes conversations nor reduces model context.

## Immutable files and PDF history

Immutable upload originals and closed delivered artifact versions can share a
content-addressed object on the same filesystem. Their existing names and API
paths remain independent hardlink references, with normal reads. Existing
writable hardlinks and mutable workspace/editor sources never enter this store.
Artifact writes continue to use atomic replacement. A durable ownership index tracks attachment messages and artifact versions.
Backfill and attachment edits are indexed in bounded idle batches. Active writes
only coalesce changed message IDs; they do not parse attachment JSON on every
streaming update. Absence is never treated as proof until indexing completes.
A missing logical link is restored when its database owner
survives an interrupted deletion. An object is released only after every logical
reference and physical link is gone and a seven-day grace period has elapsed.
The current incremental file migration considers files of at least 16 KiB.

PDF revisions use shared SQLite objects and separate revision references. All
existing revisions are retained; the previous history-count trimming is removed.
Small revisions migrate while idle. Revisions over 2 MiB migrate in the separate
offline window to avoid holding a foreground database write lock for a large BLOB.
Restoring a revision reads through `pdf_document_history_reads` and preserves the
original response contract. Removing one reference cannot remove another revision.

## Space accounting

The scanner advances through bounded directory batches, counts allocated bytes
once per filesystem identity, and reports shared links separately. WAL and other
sidecars are ordinary measured files. It reports partial scans, inaccessible or
redirected entries, and the largest retained files. Measurements describe the
scan interval, not an atomic snapshot of a changing filesystem; filesystem
directory/metadata overhead is excluded.

Settings distinguish verified disposable allocations, logical payload savings,
and free pages reusable inside SQLite. Neither a SQL deletion nor a compression
saving is presented as bytes already returned to C:. Reclaimable previews are
bounded and explicitly partial when more candidates await inspection.

## Offline compaction and recovery

Compression waits for at least 2 GiB free. Database replacement requires its
estimated output plus that reserve. The desktop quiesces admission, checks
workers/leases, stops the owning runtime, and launches the fixed native executable
with `--storage-compact`. The native process must acquire exclusive generation
authority before proceeding. Runtime storage is processed before content storage.

New managed databases use incremental vacuum. Existing databases are converted
with `VACUUM INTO`, integrity/FK checks, row-identity checks and exact comparisons
of table values. Live external readers cause deferral. An fsynced swap journal
records copying, prepared and installed phases; a verified previous database is
kept until the replacement is installed. The next runtime startup recovers a
pending swap before opening services. Ordinary startup does no compaction scan.
Input resuming during compaction stops the helper and restarts the runtime through
this recovery path. Unknown or unverifiable maintenance files are retained.

## Validation and release checks

Tests cover lossless message recovery, edits across idle slices, SQLite disk-full
rollback, checksums, leases, quarantine recovery, junctions, shared files, PDF undo
references, retained lesson work, bounded recurring checks, expired schedule keys,
uncertain jobs, interrupted swaps and active database readers. Desktop tests cover
log caps, one-worker scheduling and deferral. A browser fixture checks Storage
controls, explicit actions, partial accounting and authorization errors.

Run the focused checks from the respective projects:

```text
dashboard: node scripts/run-storage-tests.mjs
dashboard: node scripts/benchmark-storage.mjs [read-only-source-brain.db]
desktop:   node node_modules/typescript/bin/tsc --noEmit --incremental false
native:    cargo test -p breadboard-runtime-core --lib --offline
native:    cargo test -p breadboard-runtime-cli --offline
```

The benchmark copies at most 96 source rows into an in-memory database. It never
compresses or changes the source installation. A local sample on 2026-11-13 saved
21.17% of eligible payload bytes including hot projections, recovered exactly,
and retained identical search results. Forty cold-page measurements of up to
50 messages added 33.75 ms at p95 in the final isolated run, below the 100 ms target. This is not a claim
about total application savings.

The isolated in-memory write CPU probe measured 0.1754 ms without the adapter and
0.1855 ms with it (about 0.010 ms additional, or 5.71%). This is a microbenchmark
of a database update, not a passing result for the end-to-end streaming gate.
Attachment JSON parsing was moved out of active writes after this probe exposed
the cost of synchronous indexing. The focused integration/browser suite passes
169 tests; native core and CLI suites pass 383 and 92 tests respectively.
The broader attachment run has three existing source-pattern assertion failures
in `chat-attachments.test.mjs` and `model-attachments.test.mjs`; these unrelated
assertions were not weakened to obtain a passing result.

The separate 5% packaged-app startup, listing, search and active-streaming gate
still requires paired measurements on the built release. Type checks, unit tests
and the payload benchmark do not substitute for that deployment measurement.
Build/restart the dashboard, desktop and native runtime together before enabling
these policies on an installation. Loading the updated database adapter can
create additive schema objects before maintenance is enabled.

## Local deployment verification — 2026-11-13

The dashboard production build, desktop build and native release build completed.
Breadboard was restarted normally, and the running runtime migrated to schema 14.
The live check exposed a missing request-body allowance on the native maintenance
endpoint. It now accepts only the bounded empty JSON object from the dashboard;
an authenticated-socket regression test covers this route. The corrected native
release was rebuilt, its staged executable hash verified, and Breadboard restarted
again at 13:25 Europe/Amsterdam.

Authenticated storage status returned 200; the same request without authentication
returned 401. Nine real maintenance batches returned 200 and advanced both the
runtime retention cursor and attachment ownership index. The partial filesystem
scan reached 807 files, with no skipped entries. These initial batches removed no
files and compressed no payloads: old job records lacking verifiable result files
were retained, and attachment ownership backfill remained incomplete.

The running Settings → Storage panel loaded with automatic housekeeping enabled,
the manual cleanup control available, a last-maintenance result, and no alert.
All 64 messages fingerprinted before deployment matched exactly after the live
maintenance batches. Automatic execution itself was not observed during this
interactive check; the lifecycle worker waits for two minutes of system inactivity.

NTFS compression of inactive generated dashboard-build sandboxes retained all
their files and reduced their allocation from 5,342,633,760 to 1,325,821,952 bytes,
recovering about 3.74 GiB. After builds and removal of disposable Rust test outputs,
C: had approximately 5.75 GiB free. No data was moved to another drive. These
deployment checks do not replace the outstanding paired 5% performance gate above.
