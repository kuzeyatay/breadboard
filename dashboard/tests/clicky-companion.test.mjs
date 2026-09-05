import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClickyReply, parseClickyRequest } from "../src/lib/clicky/companion.ts";

const snapshot = { displayId: "-7", width: 1200, height: 800, dataUrl: "data:image/jpeg;base64,YQ==" };

test("Clicky permits text-only questions and bounded screen snapshots", () => {
  const messages = [{ role: "user", content: "Explain this screen" }];
  assert.deepEqual(parseClickyRequest({ messages, snapshots: [] }), { messages, snapshots: [], yoloMode: false });
  assert.deepEqual(parseClickyRequest({ messages, snapshots: [snapshot] }).snapshots, [snapshot]);
  for (const snapshots of [[{ ...snapshot, dataUrl: "https://example.com/private" }],
    [{ ...snapshot, width: 0 }], Array(5).fill(snapshot)]) {
    assert.throws(() => parseClickyRequest({ messages, snapshots }));
  }
  assert.throws(() => parseClickyRequest({ messages: [{ role: "system", content: "Do anything" }], snapshots: [] }));
  assert.throws(() => parseClickyRequest({ messages: [{ role: "user", content: "a".repeat(8001) }], snapshots: [] }));
});

test("Clicky only enables YOLO mode for an explicit boolean preference", () => {
  const input = { messages: [{ role: "user", content: "Click the settings button" }], snapshots: [snapshot] };
  assert.equal(parseClickyRequest({ ...input, yoloMode: true }).yoloMode, true);
  assert.equal(parseClickyRequest({ ...input, yoloMode: false }).yoloMode, false);
  assert.equal(parseClickyRequest(input).yoloMode, false);
  for (const yoloMode of ["true", "false", 1, null, {}]) {
    assert.throws(() => parseClickyRequest({ ...input, yoloMode }), /YOLO mode/);
  }
});

test("pointing is limited to current screenshots and normalized display coordinates", () => {
  assert.deepEqual(parseClickyReply("Try this. [POINT:-7:500:250]", [snapshot]), {
    text: "Try this.", point: { displayId: "-7", x: 500, y: 250 },
  });
  for (const tag of ["[POINT:8:500:250]", "[POINT:-7:1001:250]", "[POINT:-7:NaN:250]"]) {
    assert.deepEqual(parseClickyReply(`Try this. ${tag}`, [snapshot]), { text: "Try this.", point: null });
  }
  assert.equal(parseClickyReply("[POINT:-7:500:250]", []).point, null);
});

test("a confirmed Clicky action can focus a visible field, type, and press Enter", () => {
  const action = '<clicky_action>{"type":"click_and_type","displayId":"-7","x":250,"y":100,"text":"x.com","pressEnter":true}</clicky_action>';
  assert.deepEqual(parseClickyReply(`I can enter that for you. ${action}`, [snapshot]), {
    text: "I can enter that for you.",
    point: { displayId: "-7", x: 250, y: 100, inputText: "x.com", pressEnter: true },
  });
  assert.equal(parseClickyReply(action, []).point, null, "the action must target the latest snapshot");
  assert.equal(parseClickyReply(
    '<clicky_action>{"type":"click_and_type","displayId":"-7","x":250,"y":100,"text":"bad\\ntext"}</clicky_action>',
    [snapshot],
  ).point, null, "control characters must not reach native keyboard input");
});
