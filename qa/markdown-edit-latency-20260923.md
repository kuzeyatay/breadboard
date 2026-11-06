# One-note Markdown edit latency — 23 September 2026

The completed request was “fix the markdown content here such that it renders correctly” in EM 1, chat session 890.

## Observed cause

- The saved response reports 1,095,383 ms (18 minutes 15 seconds).
- Council receipt `crun_a9b81323fc434d8690dd5ed1030c8df5` ran from 08:38:08.809 to 08:40:35.975 UTC: approximately 147 seconds. The `small_revision` request used `lite_council`, making three model calls (draft, review, rewrite), consuming 39,070 total tokens.
- `/api/markdown-edit` then awaited `publishQuartzAfterMutation` inside the Garden mutation lease. The remaining approximately 16 minutes occurred after the model finished; the client showed Thinking throughout and could not display the saved note until publication returned.
- The direct edit branch also discarded the reserved assistant message identity. The completed answer was migrated as a separate message, leaving the original checkpoint pending.

## Change

- Explicitly use direct council mode for this single-note endpoint, retaining the selected model.
- Use the shared ChatMock transport, which disables SDK retries.
- Return canonical Markdown after saving and releasing the lease. Queue the derived publication in the background, logging any publication failure separately.
- Disable source migration during the index refresh.
- Forward the turn abort signal through the browser request and model call; check cancellation again before saving.
- Preserve the reserved assistant message ID and client message ID when persisting the completed answer.

## Verification

- All five new `markdown-edit-route.test.mjs` tests passed: stalled publication, failed publication, cancellation, concurrent-edit conflict, and frontend message identity/cancellation.
- All eight `garden-markdown-refresh.test.mjs` browser tests passed, including immediate article refresh and canonical reload behavior.
- All seven `garden-turn-crash-recovery.test.mjs` tests passed.
- Route ESLint and scoped diff whitespace checks passed.
- The additional revision proposal suite passed four checks and failed two existing writer fixtures because their mocked lease module does not export `assertGardenMutationWritePaths`. Neither that writer nor those fixtures was changed for this fix.

## Activation

The supported `node desktop/scripts/build-dashboard.mjs` command refused before compilation: 17,523 MB free Windows commit was below the 11,321 MB reserve plus 11,264 MB build estimate. The running standalone app still uses its existing build. Rebuild and restart when sufficient memory is available; no resource guard was bypassed.
