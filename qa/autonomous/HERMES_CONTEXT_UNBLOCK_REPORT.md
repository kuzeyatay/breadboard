# Hermes Context Unblock Report

Date: 2026-08-15  
Scope: authenticated Electron Garden Chat only. Broad Hermes provider inventory remains paused.

## Result

The corrected context gate passes through the real Electron UI:

- active conversation context: 5/5 fresh-marker trials PASS;
- renderer refresh restores the marker: PASS;
- a new conversation does not disclose the marker, and the original conversation still restores it: PASS.

Final retained run: `20260815201722-54492-43e269ad`.

## Blockers found and disposition

The primary product defect was `HERMES_RUNTIME`. `HermesRpcClient.events()` replayed the previous live-session event journal whenever a new stream was opened. Garden Chat opens that stream immediately before submitting the next prompt; the prior turn's `message.complete`/idle frame could therefore terminate the new stream early. The dashboard persisted the previous answer or an empty assistant block, matching the reported blank Thought/Regenerate state. Fresh subscriptions now observe live frames only; durable recovery remains through `session.turn_result`.

Other concrete blockers were separated rather than hidden:

- `BREADBOARD_SERVER`: the planner treated the conversational noun “message” as an external action. The matcher now requires a recipient/object for messaging actions.
- `QA_HARNESS`: the assistant-row selector did not match the actual workspace, alert/regenerate UI was treated as a terminal failure, and trace flushing assumed Playwright had created an output directory. The selector, terminal checks, and trace writer were corrected.
- `MODEL_BEHAVIOR`/test criterion: one provider acknowledgment was non-empty and marker-free but not literally “Got it.” Turn 1 now checks the required invariant—terminal, non-empty, and no marker disclosure—without requiring a wording choice.
- `QA_HARNESS`/prompt wording: the isolation probe said “in the other conversation,” which intentionally activated Breadboard's explicit cross-chat memory feature. It now asks what was provided “earlier in this conversation,” as required by the isolation test.

An explicit empty-stream guard was also added in the Garden adapter. A successful stream with no answer text now emits and persists “The assistant returned no answer. Please try again.” with a `message.empty_response` audit event, preventing a blank completed bubble.

## Production and test changes

Production changes:

- `dashboard/src/lib/agent-runtime/hermes-wire.ts`: do not replay a prior event journal on a fresh stream subscription.
- `dashboard/src/lib/hermes/task-plan.ts`: distinguish references to a previous message from messaging a recipient.
- `dashboard/src/lib/hermes/garden-chat-adapter.ts`: turn an empty terminal stream into an explicit retryable response.

Regression coverage:

- `dashboard/tests/hermes-wire-events.test.mjs`: a fresh subscription ignores a prior turn's completion event.
- `dashboard/tests/hermes-task-plan.test.mjs`: conversational previous-message wording stays conversation-only while recipient messaging remains confirmed external action.
- `dashboard/tests/hermes-garden-assistant-session.test.mjs`: empty Hermes output becomes the explicit retryable response.
- `qa/electron/specs/hermes/context-correction.spec.ts`: sanitized request/response trace, five independent markers, refresh, and isolation checks.

## Sanitized execution evidence

In the final run, each Turn 1 `/api/chat` returned 200 and each chat-session PATCH returned 200. Every Turn 2 request contained the same redacted `chatSessionId` and `clusterSlug` presence markers and exactly this structural history:

```text
user      contentLength=177  containsMarker=true
assistant contentLength=7    containsMarker=false
user      contentLength=98   containsMarker=false
```

The Turn 2 response completed with a 200 response and a persisted assistant message of length 14 with `containsMarker=true`; the raw marker and credentials were not written to the trace. This confirms the marker reached the provider as prior conversation history and that the retrieval prompt itself did not contain it.

After refresh, the request included the persisted setup, acknowledgment, retrieval, and refresh history and returned the marker again. In the isolation conversation, the request contained one marker-free user message, the assistant response was non-empty and marker-free, and the subsequent return to the original conversation retrieved the marker.

## Five-trial and follow-up results

The final active-context trace records:

```text
trial 1 PASS
trial 2 PASS
trial 3 PASS
trial 4 PASS
trial 5 PASS
```

Each trial used a newly generated `CONTEXT-<random>` value and a fresh garden/chat session. The final run's B and C traces are retained beside the active trace under the same run directory.

## Validation

Passed:

- `npm.cmd run qa:electron:typecheck`
- `node --test dashboard/tests/hermes-wire-events.test.mjs dashboard/tests/hermes-garden-assistant-session.test.mjs dashboard/tests/hermes-task-plan.test.mjs` (61/61)
- `npm.cmd run qa:electron:hermes -- --grep "corrected Hermes context invariants" --skip-desktop-build` (3/3)

No broad Hermes inventory was resumed. The focused gate is now unblocked; any broader run should remain a separate, explicitly authorized follow-up.
