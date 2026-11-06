# PDF upload recovery fix — ready to apply

The `5XTAO_KJ_5GLab_1a.pdf` worker saved the document and published it, then
failed while reacquiring the garden mutation lease to finalize its result.
The diagnostic log names `GardenMutationBusyError` and a concurrent Learn
planning lease. Its automatic retry was queued behind another PDF import.

The worker change and its regression tests are in
`qa/ingest-resume-lock-fix.patch`. They are **not applied**: Windows prevents
writes to the running worker entry point. The user requested that current jobs
keep running. No jobs were stopped or restarted, and no saved upload was deleted.

After Breadboard has closed, from the repository root:

```powershell
git apply --check qa/ingest-resume-lock-fix.patch
git apply qa/ingest-resume-lock-fix.patch
node --test dashboard/tests/runtime-v2-document-ingestion-worker.test.mjs
```

The patch waits for a competing garden writer before stopping heartbeats and
assigning the final completion sequence. It covers both newly committed uploads
and recovery of an already committed result. Cancellation remains abortable.

The UI source changes are already in the working tree: restored upload rows
poll their durable job status, display queued work accurately, refresh Documents
when they settle, and ignore stale responses from a previous garden. The running
desktop uses a built dashboard, so these source changes require the normal
dashboard rebuild/relaunch to appear in that app.

Validation on September 23, 2026:

- All 25 worker tests passed against the corrected copy.
- Both new lock-contention regressions failed against the unchanged worker and
  passed against the corrected worker, with heartbeats continuing during waits.
- 30 distinct browser, recovery-store, recovery-route, upload, and ingestion
  compatibility tests passed.
- ESLint passed the new hook and the changed store/API modules. The large
  workspace component still reports two existing `set-state-in-effect` errors
  in chat branch restoration and seven unrelated warnings.

The patch check passes against the current working tree, preserving the worker
changes that were already present before this task.
