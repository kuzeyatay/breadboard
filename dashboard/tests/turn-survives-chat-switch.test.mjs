import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const hookSource = fs.readFileSync(
  new URL("../src/app/components/hermes/use-agent-session.ts", import.meta.url),
  "utf8",
);
const directServiceSource = fs.readFileSync(
  new URL("../src/lib/conversations/direct-turn-service.ts", import.meta.url),
  "utf8",
);
const messageRouteSource = fs.readFileSync(
  new URL(
    "../src/app/api/hermes/sessions/[sessionId]/messages/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const sessionPresentationSource = fs.readFileSync(
  new URL("../src/lib/hermes/session-presentation.ts", import.meta.url),
  "utf8",
);

const sendSource = hookSource.slice(
  hookSource.indexOf("const send = useCallback("),
  hookSource.indexOf("const steer = useCallback("),
);

test("a composed turn is dispatched through one authoritative send", () => {
  assert.match(sendSource, /const dispatchTurn = async \(\): Promise<Response> =>/);
  assert.equal(
    (hookSource.match(/sessions\/\$\{activeSessionId\}\/messages/g) ?? []).length,
    1,
    "the messages endpoint must have a single caller, so no path can skip it",
  );
  assert.match(sendSource, /const stillViewing = \(\) => viewEpochRef\.current === viewEpoch;/);
});

test("opening another chat withholds the view, not the turn", () => {
  const dispatchWindow = sendSource.slice(
    sendSource.indexOf("const activeSessionId = ensured.id;"),
    sendSource.indexOf("const sendResponse = await dispatchTurn();"),
  );
  assert.ok(dispatchWindow.length > 0, "the dispatch window must be readable");
  // The regression: a regenerate spends a branch-runtime hop and a stream
  // handshake before it reaches the server, and every one of those awaits used
  // to return the turn to nowhere if the reader had moved on. The transcript
  // then kept a branch switcher for an attempt that never existed.
  assert.doesNotMatch(
    dispatchWindow,
    /if \(viewEpochRef\.current !== viewEpoch\) return;/,
    "leaving the chat must not abandon a turn before it is dispatched",
  );
  assert.match(
    dispatchWindow,
    /if \(!stillViewing\(\)\) \{\s*await dispatchTurn\(\);\s*return;\s*\}/,
    "a turn whose reader left is sent without opening this chat's event stream",
  );
  assert.match(
    dispatchWindow,
    /if \(!stillViewing\(\)\) \{\s*streamController\?\.abort\(\);\s*await dispatchTurn\(\);\s*return;\s*\}/,
    "a stream aborted by the chat switch still leaves the send to make",
  );
  assert.match(
    dispatchWindow,
    /if \(stillViewing\(\)\) throw handshakeError;/,
    "a handshake failure is only an error for the chat still on screen",
  );
});

test("an abandoned turn writes to the server and to nothing else", () => {
  const directSource = hookSource.slice(
    hookSource.indexOf("const streamDirectTurn = useCallback("),
    hookSource.indexOf("const send = useCallback("),
  );
  assert.match(
    directSource,
    /if \(input\.viewEpoch === viewEpochRef\.current\) \{\s*input\.commit\(assistant\);\s*\}/,
    "a hidden direct turn must keep draining while withholding only its view updates",
  );
  assert.doesNotMatch(
    directSource,
    /signal: controller\.signal/,
    "view teardown must not own the direct provider request",
  );
  assert.match(
    directSource,
    /if \(!response\.ok && stopWasRequestedForTurn\(\)\) \{[\s\S]*?return;/,
    "a provider handshake stopped by the user must stay Cancelled",
  );
  assert.match(
    directSource,
    /else if \(input\.viewEpoch === viewEpochRef\.current\) \{\s*transition\("running"\);/,
    "run state and activity belong to the chat on screen",
  );
  const sendUpdates = sendSource.slice(
    sendSource.indexOf("const stillViewing ="),
    sendSource.indexOf("if (!isAgentModeEnabled())"),
  );
  assert.match(
    sendUpdates,
    /if \(stillViewing\(\)\) \{\s*sessionRef\.current = activeSessionId;/,
    "the selected chat must not be pulled back to the one the turn belongs to",
  );
});

test("transport loss is viewer detachment, never an interrupted answer", () => {
  assert.doesNotMatch(
    messageRouteSource,
    /status: request\.signal\.aborted \? "aborted" : "failed"/,
  );
  assert.doesNotMatch(
    messageRouteSource,
    /retrieveDocumentAttachments\([\s\S]*?request\.signal/,
  );
  assert.doesNotMatch(
    directServiceSource,
    /input\.request\.signal\.addEventListener/,
  );
  const cancelBody = directServiceSource.slice(
    directServiceSource.indexOf("cancel() {"),
    directServiceSource.indexOf("return new Response(body"),
  );
  assert.doesNotMatch(cancelBody, /providerAbort\.abort\(\)/);
  assert.doesNotMatch(cancelBody, /finish\("aborted"/);
  assert.match(directServiceSource, /export function abortDirectProviderTurn/);
});

test("a restored pending answer returns to Thinking until it settles", () => {
  assert.match(
    sessionPresentationSource,
    /pending: presented\.status === "pending"/,
  );
  assert.match(hookSource, /function pendingRestoredTurn/);
  assert.match(hookSource, /const resumePendingConversation = useCallback/);
  assert.match(hookSource, /label: "Thinking"/);
  assert.match(
    hookSource,
    /loadHermesSessionDetail\(surface, id, \{\s*revalidateAfterPending: true/,
  );
  assert.match(hookSource, /resumePendingConversation\(id, restoredMessages, viewEpoch\)/);
});

test("reopening during the pre-reservation gap keeps the local turn visible", () => {
  assert.match(hookSource, /const localInFlightTurnsRef = useRef\(new Map</);
  assert.match(
    sendSource,
    /localInFlightTurnsRef\.current\.set\(\s*startingSessionId,\s*localInFlightTurn/,
  );
  const openSource = hookSource.slice(
    hookSource.indexOf("const openSession = useCallback("),
    hookSource.indexOf("const refreshSession = useCallback("),
  );
  assert.match(
    openSource,
    /localInFlightTurn\?\.messages \?\? cached\?\.messages/,
  );
  assert.match(
    openSource,
    /!optimisticTurnPersisted &&\s*!restoredRun[\s\S]*resumePendingConversation\(id, normalizedOptimistic, viewEpoch, \{\s*allowOptimistic: true/,
  );
  assert.match(
    hookSource,
    /localSendStillRunning \|\| Date\.now\(\) < persistenceGraceUntil/,
  );
});
