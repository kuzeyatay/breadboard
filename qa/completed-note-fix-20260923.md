# Completed response and saved-note reader repair

The affected EM 1 conversation is chat 893, “Comparing electromagnetics concepts”.
Its final assistant message, `msg_29323249`, and Hermes run were already complete
at 14:37:07 UTC. The stored duration is 345,440 ms. The screenshot's ongoing
Thinking state therefore did not describe the durable response state. Reopening
the chat showed Thought with the correct 5m 45s duration.

The Markdown source for `fields-vectors-and-cartesian-coordinates-1790174177632`
was saved, but its corresponding published HTML was absent. The static reader
returned a 404 before the authenticated canonical-document bridge could start.

## Changes

- Pass each response's completion timestamp into ActivityPanel. It overrides a
  stale chat connection and freezes the completed timer. Explicitly running
  delegated agents and artifacts retain their existing activity behavior.
- Serve an empty reader shell for unpublished note routes using existing chrome
  from the same garden. Strip the template's article and document metadata and
  rebase resources for nested paths. The authenticated document bridge supplies
  the actual note; the static service never reads source Markdown.
- Keep asset misses, hidden paths, malformed paths and traversal attempts as
  errors. Bound template discovery and retain normal prebuilt-file handling.
- Include the new shell module and its parse5 dependency in desktop packaging.

## Verification and activation

- All 18 focused tests pass: response timing, stale streaming state, streamed
  Garden completion/recovery, static reader behavior, nested note resources,
  HEAD requests, and browser rendering through the canonical bridge.
- Focused ESLint on the activity component, timing helper and reader service,
  JavaScript syntax checks, and diff whitespace checks pass. Broader lint on
  the existing chat surfaces reports two pre-existing set-state-in-effect
  errors at workspace-client.tsx lines 862 and 870, plus existing warnings.
- Runtime manifest tests: 18 pass; the pre-existing exact-service-count test
  fails because it expects 32 services but the manifest already contains 34
  (including acestep and bambu-printer).
- Restarted only the Quartz reader service to release Windows' executable-file
  locks and install the service fix. Its health endpoint is ready and live
  requests for unpublished note routes receive the fallback shell.
- Restored a derived reader shell for the affected note without changing its
  Markdown. Verified in the running desktop app: saved title, 25,849 characters
  of rendered article text, and formatted equations. Screenshot:
  `qa/completed-note-reader-20260923.png`.
- Opening an additional verification tab hit the existing eight-view limit.
  Closed that verification tab and opened the note in the completed EM 1 chat's
  existing tab instead. The note now renders normally.
- The dashboard still serves its previous standalone build. The completion UI
  guard is changed and tested in source; a dashboard rebuild/restart is required
  to activate it. Another chat was running, so the dashboard was not restarted.
