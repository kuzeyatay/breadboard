# Personal intelligence in Breadboard

Breadboard should be able to pick up a piece of work where its reader left it. A good test is to teach a habit in one conversation, start another on a related document, and see whether the first answer or suggestion uses it. Opening an unrelated document should produce a different result.

## How the update works

Browser history is available to personalized chats by default. On startup or sign-in, the desktop assigns visits saved before account tracking to the authenticated account. Later visits follow the account that made them. Turning off Personalize excludes history from the chat.

1. **Find the work.** A turn can use the current page, selected text, Garden, and owned records to resolve references such as “my review board” or “where I left off.” An open task, edited document, or prior decision carries different evidence from a visit. When needed, the resolver can consult enabled Recall, activity, and connected sources within a bounded wait.
2. **Learn what recurs.** Explicit corrections can replace a convention. Visits on different days can establish a familiar destination. Repeated sequences of different activities on a project can support a suggested workflow. Accepting or dismissing a suggestion updates a small Cadence-derived predictor, so a later suggestion with similar cues can move up or down. Showing a card supplies no training outcome.
3. **Use the lesson where it belongs.** Terminal can resume work across eligible projects. A Garden, document, browser page, or selection supplies a narrower focus for answers and suggestions. Shared room replies use decisions from that room and its visible thread. Personalization and temporary-chat settings govern access. Each source retains its own access rules.
4. **Let the reader correct it.** Learned cards give a reason and support feedback. Source-backed calendar changes are proposals, with a fresh source check before acceptance. A user's manual edit can invalidate an outstanding proposal.

## What to measure next

| Question | Test |
| --- | --- |
| Does Breadboard save a clarification? | Compare the same request and saved preferences with and without retrieval. Count correct next steps and needless questions separately. |
| Does a correction transfer? | Teach a preference, hold out a related page or task, and check the answer, starter card, and typed completion. Repeat in an unrelated Garden and another account. |
| Does the right habit persist? | Replay several weeks in chronological order, including old projects, reversals, deleted sources, and a change of routine. Measure how long a superseded suggestion keeps appearing. |
| Is a suggestion worth interrupting someone for? | With an opt-in pilot, track accepted suggestions, later edits, dismissals, and time to first useful action per surface. Include sessions that produce no suggestion. |

The paired replay and surface replay use synthetic workspaces and the active local ChatMock endpoint. Their checked-in runners are `dashboard/scripts/verify-personal-context-live.mjs` (pass an output path and `--edge-cases`) and `dashboard/scripts/verify-personal-suggestions-live.mjs` (pass an output path). The historical lookup runner uses an isolated copy of desktop history. Longitudinal usefulness still requires evidence from continued use.
