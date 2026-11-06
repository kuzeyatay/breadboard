# Breadboard storage

## Hybrid storage: active databases on C, large payloads on D

The selected layout keeps `Data/database`, `Data/runtime-v2/runtime-v2.sqlite3`,
canonical job metadata, conversation history, service configuration, and secrets
in the existing C profile. Large payloads use the separate direct directory
`D:\BreadboardLargeFiles`. The earlier partial `D:\BreadboardData` staging copy
is retained but is not active and must not be selected as the hybrid root.

Electron reads `<userData>/breadboard-bulk-storage.json` and passes its optional
`bulkRoot` through the private Runtime bootstrap. Native code identity-pins that
directory independently of `dataRoot`; no ordinary job or database path gains
cross-root authority. QA ignores the production preference. Ambient environment
variables and submitted job payloads cannot select this root. A disconnected
bulk drive does not block the core C application, but bulk-backed setup, agents,
and media report unavailable rather than silently using C for new downloads.

Dependency payloads use a closed list: selected `runtime-v2/services/<id>/.venv`
directories, explicit pure toolchain roots, ACE source/cache, Resource2Skill
browsers, and the top-level HyperFrames CLI/browser, OpenScience CLI, and OpenWork
runtime directories. Runtime state roots stay on C. CareerOps and MoneyPrinter
toolchain roots contain user state and remain on C. Existing installations read
from C until a successful verified D setup publishes a bounded
`.breadboard-bulk-ready.json` marker and the required executable files exist.
Install/reinstall writes D for bulk payloads. All 19 managed specialists have
fixed removal recipes for their dependency directories on both C and D. Every
target is checked before either drive is changed; redirected paths are refused.
The ten expanded recipes require native setup exclusion version 3. Removal keeps
artifacts, configuration, conversations, source and shared caches. Music's
explicit "Remove music models and tools" action also removes its checkpoints;
generated tracks remain.

Classroom's app, pnpm tools and dependency cache use D. Its `data` junction points
to the stable C lesson directory. Installation builds at the final path because
pnpm creates absolute Windows junctions. When bundled Node lacks Corepack, setup
installs only the pnpm version and SHA-512 integrity pinned by the OpenMAIC source.

New Hugging Face and Torch downloads for the managed Python agent workers use
fixed directories under `runtime-v2/toolchains/cache` on D. Existing C model
caches are left intact. Model-cache routing does not change database paths or
block coding and browser workers when D is disconnected. Windows Python setup
uses hardlinks only when its validated package cache and environment share a
local volume; installations across volumes use copies.

Scriberr uploads use only `runtime/scriberr/uploads` under the bulk root. Its
SQLite database, JWT secret, transcripts, temporary files, and Python/model
environment remain C. The dedicated audited helper
`audits/agent-repairs-2026-11-06/migrate-scriberr-uploads.mjs` stages a verified
copy, then requires an idle stopped Runtime for a fresh verification, database
backup, exact upload-prefix rewrite, SQLite integrity check, and activation
marker. It preserves every original upload. The native marker is bound to the
current C data root, preventing a copied QA profile from accessing production
media. Verify historical playback and fresh uploads before separately approving
removal of verified obsolete C copies.

After the final offline upload rewrite and compiled desktop/native checks,
activate the preference with the guarded helper (all directories must exist):

```powershell
node --experimental-strip-types desktop/scripts/configure-bulk-location.mjs --user-data=C:\Users\<user>\AppData\Roaming\breadboard-desktop --bulk-root=D:\BreadboardLargeFiles --app-root=C:\Users\<user>\breadboard
```

It acquires the same migration lock, checks native jobs and the process owner
twice, refuses to replace a different existing bulk root, and atomically writes
the profile preference. Root ACLs must grant only the account owner, SYSTEM,
and administrators. Keep the external drive connected while bulk agents or media
are in use. Reconnect and restart Runtime to re-establish an unavailable pinned
drive authority.

## Optional full data-root migration

This is the retained full-copy helper, not the selected hybrid layout above.

The desktop stores its selected data directory in
`<Electron userData>/breadboard-storage.json`. This small preference stays in the
Electron profile when the data moves. Both development and packaged desktop
builds use it; QA profiles deliberately ignore it. The selected directory must
be an existing, direct local path, separate from installed program files.

Use the migration helper with Node 24 (or another supported Node version with
`node:sqlite` and type stripping):

```powershell
node --experimental-strip-types desktop/scripts/migrate-data-location.mjs --user-data C:\Users\<user>\AppData\Roaming\breadboard-desktop --destination D:\BreadboardData
```

This stages a copy while Breadboard continues working. It compares SHA-256
hashes, uses eight bounded copy workers, and reports changed or busy source
files for retry. It does not select the new directory or delete the original.
Use a private destination directory: on Windows its ACL should grant access
only to the account owner, SYSTEM, and administrators.

The scan uses bounded parallel directory and metadata reads. An incremental
`.breadboard-migration-inventory.jsonl` checkpoint inside the private destination
binds the exact source and destination, so an interrupted staging pass can resume
completed directories. A partial final checkpoint record is discarded while
retaining its complete prefix. This cached inventory is used only for staging;
activation always inventories the source afresh and verifies every copied file.

Successful SHA-256 checks also produce a private, source/destination-bound
`.breadboard-migration-verified.jsonl` ledger. The final pass reuses a check only
when both files still have identical device/file identity, size, modification
time, change time, and birth time at full filesystem precision. Changed,
missing, replaced, or ambiguous files are hashed again; restoring modification
time alone cannot reuse an old check. Invalid receipt files are preserved
separately and force fresh hashes. Source stability and SQLite integrity are
checked again before the preference switches.

Only the contents of the exact `runtime-v2/temp` process scratch directory are
omitted, and its directory is recreated empty. Native services assign this path
to `TEMP`/`TMP`; canonical uploads remain under `runtime/jobs/.../inputs` and are
copied. The source scratch files are untouched. Other folders called `temp`,
artifacts, retained jobs, models, and configuration are preserved. A busy file
elsewhere is reported for retry during staging and blocks final activation.

After active user jobs finish, shut Breadboard down normally and run the same
command with `--activate`. Do not terminate active Learn work to migrate storage.
When the app is already offline, running `--activate` directly avoids an extra
staging pass. Large retained histories can take considerable time to scan and
copy; progress counts cover the complete history without excluding old jobs.
The final pass requires the native owner to have exited and no unfinished user
jobs to remain. A queued internal scheduler tick is safe to retain. The helper
blocks desktop startup while it performs the final copy, verifies source
stability and SQLite integrity, and atomically writes the storage preference.
Start Breadboard only after this command succeeds.

The helper preserves directories, including empty directories, and internal
package links by pointing them at the copied dependency store. It refuses links that resolve outside the source data tree,
and never traverses a redirected destination. Files that disappeared after
staging, including obsolete SQLite WALs, move to a separate staging-history
directory instead of reappearing in the activated data.
Windows directory junctions do not require file-symlink privileges. A data tree
containing actual file symlinks requires an account that can create them; the
helper does not silently replace links with copies or hard links.

The original directory remains intact. Do not delete it immediately: some
legacy workspaces or Python launchers may still contain absolute paths. Core
Runtime job paths and standard artifact storage paths are relative and move
with the data; verify representative historical artifacts and agent runtimes
after activation. Repair relocated Python environments when their launchers
still refer to the previous location.

`breadboard-data-migration.json` in the Electron profile records source,
destination, verification counts, and any staging errors. It contains no file
contents or account tokens. A crash during final activation may leave
`breadboard-data-migration.lock`; verify that its recorded helper PID and the
native Runtime have exited before removing that lock and retrying.

To roll back before any new work has been created, stop the desktop, restore
the previous storage preference (or remove it when reverting to the original
`<userData>/Data`), and restart. Once new work exists in the destination, perform
a verified reverse migration instead of switching to an older snapshot.
