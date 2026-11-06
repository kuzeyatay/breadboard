# Selected Garden PDF progress connection

The reported toast was from selecting `5EPF0_lecture1.pdf` in the Garden
workspace and asking a question. Selecting a source starts
`distillGardenDocumentSkill`; its caught transport error was rendered verbatim
as `<document title>: network error`.

The live document-skill record confirms that preparation started at
2026-09-23 14:32:32 UTC and completed at 14:44:18 UTC, with status `ready`,
10 sections, and no build error. The long-running NDJSON stream had no
keepalives or reconnection. The screenshot does not identify the lower-level
reason the connection dropped.

Changes:

- Send immediate and 15-second keepalives while document preparation runs.
- Release the viewer's timer on disconnect while letting the shared build finish.
- Reconnect up to three times to the existing build/cache after transport failure,
  temporary gateway errors, or EOF without a completion event.
- Accept completion immediately, including an unterminated final NDJSON line,
  and release stream readers.
- Preserve explicit preparation errors and cancellation; give actionable context
  instead of exposing a bare transport exception when reconnecting fails.

Verification:

- All 9 connection/stream regressions and all 23 document-skill tests passed.
- ESLint passed the three changed production modules; `git diff --check` passed.
- The live authenticated build endpoint returned HTTP 200, `cached: true`,
  `status: ready`, and slug `5epf0-lecture1-pdf` for the user's selected source.
  No question was submitted and no new model build was needed.
- The additional existing `garden-selection-attachments.test.mjs` suite has two
  failures because its mock lacks `agentActivity.start`. That workspace code and
  test fixture were not modified by this fix.

The running desktop still uses its existing compiled dashboard. The standard
build memory preflight refused activation: 11,597 MB free commit, versus an
11,321 MB reserve plus an 11,264 MB build estimate. No active chats or jobs were
stopped. Rebuild/relaunch when sufficient memory is available:

```powershell
npm run desktop:dev:lean:rebuild
```

The PDF's completed preparation is already available in the current app.
