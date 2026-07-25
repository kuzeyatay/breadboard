import test from "node:test";
import assert from "node:assert/strict";
import {
  createHermesEventNormalizationState,
  normalizeHermesEvent,
} from "../src/lib/agent-runtime/hermes-events.ts";

const normalize = (raw, state = createHermesEventNormalizationState()) =>
  normalizeHermesEvent(raw, "live-1", "runtime-1", state);

test("filters Hermes events to the live session", () => {
  assert.deepEqual(
    normalize({
      type: "message.delta",
      session_id: "other",
      payload: { text: "not ours" },
    }),
    [],
  );
});

test("maps streamed answer text without exposing the Hermes session id", () => {
  const [event] = normalize({
    type: "message.delta",
    session_id: "live-1",
    payload: { text: "Hello" },
  });
  assert.equal(event.type, "assistant.delta");
  assert.equal(event.sessionId, "runtime-1");
  assert.equal(event.payload.text, "Hello");
});

test("maps Hermes reasoning summaries to the existing persistent reasoning contract", () => {
  const [event] = normalize({
    type: "reasoning.available",
    session_id: "live-1",
    payload: { text: "Compared the inspected files." },
  });
  assert.equal(event.type, "reasoning.status");
  assert.equal(event.payload.detail, "Compared the inspected files.");
  assert.equal(event.payload.detailMode, "replace");
});

test("maps tool lifecycle events and failed structured results", () => {
  const [started] = normalize({
    type: "tool.start",
    session_id: "live-1",
    payload: {
      tool_id: "call-1",
      name: "breadboard_terminal",
      context: "Get-ChildItem",
    },
  });
  assert.equal(started.type, "tool.started");
  assert.equal(started.payload.toolCallId, "call-1");

  const [completed] = normalize({
    type: "tool.complete",
    session_id: "live-1",
    payload: {
      tool_id: "call-1",
      name: "breadboard_terminal",
      result: { success: false, error: "denied" },
    },
  });
  assert.equal(completed.type, "tool.completed");
  assert.equal(completed.payload.success, false);
});

test("a plugin tool_error JSON string is a failure, not a success", () => {
  // hermes-agent/plugins/breadboard returns tool_error() -> a JSON *string*.
  // Reading that as success told the model a denied command had worked.
  for (const field of ["result", "output", "content"]) {
    const [completed] = normalize({
      type: "tool.complete",
      session_id: "live-1",
      payload: {
        tool_id: "call-1",
        name: "breadboard_terminal",
        [field]: JSON.stringify({
          error:
            "Only read-only inspection, read-only Git, and focused existing verification commands are allowed automatically.",
        }),
      },
    });
    assert.equal(completed.type, "tool.completed", field);
    assert.equal(completed.payload.success, false, field);
  }

  const [ok] = normalize({
    type: "tool.complete",
    session_id: "live-1",
    payload: {
      tool_id: "call-2",
      name: "breadboard_terminal",
      result: JSON.stringify({ success: true, exitCode: 0 }),
    },
  });
  assert.equal(ok.payload.success, true);

  // Non-JSON output stays a success: only an explicit error demotes it.
  const [plain] = normalize({
    type: "tool.complete",
    session_id: "live-1",
    payload: { tool_id: "call-3", name: "breadboard_terminal", result: "total 4\nfile.txt" },
  });
  assert.equal(plain.payload.success, true);
});

test("maps approval requests to Breadboard permission UI without permanent grants", () => {
  const [event] = normalize({
    type: "approval.request",
    session_id: "live-1",
    payload: {
      command: "Remove-Item report.txt",
      description: "Delete report.txt",
      choices: ["once", "session", "deny"],
    },
  });
  assert.equal(event.type, "permission.requested");
  assert.equal(event.payload.risk, "delete");
  assert.equal(event.payload.allowSession, true);
  assert.equal(event.payload.requestId, "runtime-1:approval");
});

test("emits an unstreamed completion suffix before the terminal status", () => {
  const state = createHermesEventNormalizationState();
  normalizeHermesEvent(
    {
      type: "message.delta",
      session_id: "live-1",
      payload: { text: "Hello" },
    },
    "live-1",
    "runtime-1",
    state,
  );
  const events = normalizeHermesEvent(
    {
      type: "message.complete",
      session_id: "live-1",
      payload: {
        text: "Hello world",
        status: "complete",
        turn_id: "msg_turn-1",
        usage: { input: 3, output: 2 },
      },
    },
    "live-1",
    "runtime-1",
    state,
  );
  assert.deepEqual(
    events.map((event) => event.type),
    ["assistant.delta", "assistant.completed", "session.status"],
  );
  assert.equal(events[0].payload.text, " world");
  assert.equal(events[0].messageId, "msg_turn-1");
  assert.equal(events[1].messageId, "msg_turn-1");
  assert.equal(events[2].payload.status, "idle");
});

test("maps interrupted and failed completions to terminal statuses", () => {
  const interrupted = normalize({
    type: "message.complete",
    session_id: "live-1",
    payload: { text: "", status: "interrupted" },
  });
  assert.equal(interrupted.at(-1).payload.status, "aborted");

  const failed = normalize({
    type: "message.complete",
    session_id: "live-1",
    payload: { text: "", status: "error" },
  });
  assert.equal(failed.at(-1).payload.status, "failed");
});
