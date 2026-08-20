import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const hookSource = fs.readFileSync(
  new URL("../src/app/components/hermes/use-agent-session.ts", import.meta.url),
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
    /if \(input\.viewEpoch === viewEpochRef\.current\) abortRef\.current = controller;/,
    "Stop belongs to the chat on screen, never to the turn that left with the reader",
  );
  assert.match(
    directSource,
    /if \(input\.viewEpoch === viewEpochRef\.current\) \{\s*transition\("running"\);/,
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
