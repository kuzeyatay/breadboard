# Automatic source repair

Breadboard's ordinary Terminal/Garden task recovery can escalate three identical failures without artifact progress to a bounded source repair. It keeps the original task, model choice, attachments, permissions and artifact lineage. The model does not get a source-editing shell.

The controller diagnoses the failure through the configured local model gateway. It may read indexed application files and propose up to eight exact snippet edits across four existing files, plus one new behavioral test. A separate review context must approve the diagnosis and patch. Provider outages, missing dependencies, resource limits, permission refusals and unsupported requests are not source defects.

## Verification and activation

1. Require a running build that matches its source. Capture the developer checkpoint, including uncommitted application changes, into a detached Git worktree. The original checkout is unchanged by a repair.
2. Run relevant existing tests on the baseline. Reproduce the proposed assertion failure twice. All test subprocesses receive scrubbed environment variables and disposable data/temp paths. Model-written regressions additionally run under Node filesystem/process permission restrictions. Existing repository suites retain native-addon/compiler support, and their hashes must remain unchanged between baseline and repaired runs.
3. Issue the existing QA repair capability, apply only the declared edits and create a new test. Existing tests cannot be rewritten. Run the regression and related suites.
4. Put the original defect back and require the same test to fail. Reapply the fix and pass it in a fresh process. Finalize the capability's source and assertion checks.
5. Copy the installed dashboard dependency files into the candidate, preserving reviewed per-package links; the whole `node_modules` directory must be physical for Turbopack. Require enough disk for those files plus 8 GB of build headroom. Build a separate production dashboard with dependency installation disabled. Check source freshness again and seal the source/build hashes with a key outside the candidate.
6. Electron verifies the release and the unchanged baseline, waits for no resident workers or live service leases, and closes native admission. It journals the previous release before restarting its owned runtime.
7. Require three health checks naming the exact candidate. Resume the saved task once using the existing durable dispatch claim. Commit the release only when the task's normal completion and artifact checks pass.
8. A startup failure, failed task replay, failed provisional health check, Stop, or deadline causes rollback at a quiet boundary. Interrupted activation is rolled back on startup. Saved task data remains in the original data directory. A failed replay can resume on the previous release; cancellation and permission/resource refusals suppress that replay. If ordinary recovery reproduces the original defect after rollback, it may use the remaining candidate allowance. This never resets the two-candidate limit or extends the original deadline.

The native lifecycle bearer alone can quiesce or resume admission. A dashboard/tool bearer cannot restart the app through these endpoints. The repair worker has a separate native process/memory budget and concurrency of one, rather than borrowing the small background worker's allowance.

## Boundaries

- This first implementation supports source checkouts running in lean desktop mode. Packaged installations do not receive automatic source-patching authority. Explicit Goal-mode continuations keep their existing recovery behavior; this source-repair escalation belongs to ordinary task recovery.
- Authentication, permissions, migrations, dependency metadata, native/runtime code, completion validators and the repair controller are outside automatic edit scope. Repairs that cannot prove a behavioral fix remain blocked with diagnostics.
- Limits: two candidates per repair, three requests per day, two hours per request, and a 45-minute isolated build. Build resource admission and disk headroom still apply. Limits and Stop are never bypassed.
- A worktree is source isolation, not a hostile-code operating-system sandbox. Node test restrictions and scrubbed credentials reduce test authority; the trusted build pipeline still executes application/build code. Independent review and protected edit scope remain necessary.
- Rollback switches code. It does not reverse already completed publications, messages or other external actions. Resumption instructions require inspecting existing artifacts and job handles before retrying.
- Successful candidate worktrees are retained because they are the active release and rollback target. Do not delete an active or previous release directory from the journal. There is no automatic installation of missing dependencies.

## State and operation

State lives in `<BREADBOARD_DATA_DIR>/source-repair`: `config.json`, a private `release-key`, atomic request records, cancellation markers and `release.json`. `enabled: false` in configuration prevents new repairs and activations; an existing provisional release still finishes verification or rolls back. Launchers set `BREADBOARD_SOURCE_REPAIR_READY=1` only when the source installation supports release selection, preventing half-installed updates from queuing repairs.

For the initial installation, the running native host pins two launcher files against writes. During the coordinated normal shutdown, run `node scripts/self-repair/apply-launchers.mjs --apply`, then rebuild/sync the native runtime and manifests and rebuild the dashboard/desktop through the normal coordinated process. Without `--apply`, the installer reports pending files and writes nothing. It refuses concurrent edits or an active checkout lease.

Focused tests: `node --import ./scripts/self-repair/test-overlay.mjs --test scripts/self-repair/*.test.mjs dashboard/tests/task-recovery.test.mjs dashboard/tests/runtime-v2-background-scheduler-cutover.test.mjs`. The overlay uses actual source by default; `BREADBOARD_TEST_REPAIR_STAGE=1` is only for validating a pending coordinated checkpoint. Snapshot and native lifecycle suites provide additional isolation/admission coverage.
