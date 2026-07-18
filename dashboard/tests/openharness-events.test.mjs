import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOpenHarnessEvent,
  extractSessionId,
  encodeSseEvent,
} from "../src/lib/openharness/events.ts";

test("streams assistant text deltas as assistant.delta", () => {
  const event = normalizeOpenHarnessEvent(
    {
      type: "message.part.delta",
      properties: { sessionID: "s1", messageID: "m1", field: "text", delta: "Hello" },
    },
    "s1",
  );
  assert.equal(event?.type, "assistant.delta");
  assert.equal(event?.payload.text, "Hello");
  assert.equal(event?.messageId, "m1");
});

test("maps reasoning deltas to reasoning.status", () => {
  const event = normalizeOpenHarnessEvent(
    { type: "message.part.delta", properties: { sessionID: "s1", field: "reasoning", delta: "thinking..." } },
    "s1",
  );
  assert.equal(event?.type, "reasoning.status");
  assert.equal(event?.payload.detail, "thinking...");
});

test("drops events belonging to a different session", () => {
  const event = normalizeOpenHarnessEvent(
    { type: "message.part.delta", properties: { sessionID: "other", field: "text", delta: "nope" } },
    "s1",
  );
  assert.equal(event, null);
});

test("maps a running tool part to tool.started", () => {
  const event = normalizeOpenHarnessEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: { type: "tool", tool: "garden_search", callID: "c1", state: { status: "running", title: "Searching" } },
      },
    },
    "s1",
  );
  assert.equal(event?.type, "tool.started");
  assert.equal(event?.payload.toolName, "garden_search");
  assert.equal(event?.payload.toolCallId, "c1");
});

test("maps a completed tool part to tool.completed success", () => {
  const event = normalizeOpenHarnessEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: { type: "tool", tool: "read", callID: "c2", state: { status: "completed", output: "ok" } },
      },
    },
    "s1",
  );
  assert.equal(event?.type, "tool.completed");
  assert.equal(event?.payload.success, true);
});

test("maps an errored tool part to tool.completed failure", () => {
  const event = normalizeOpenHarnessEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: { type: "tool", tool: "bash", callID: "c3", state: { status: "error", error: "boom" } },
      },
    },
    "s1",
  );
  assert.equal(event?.type, "tool.completed");
  assert.equal(event?.payload.success, false);
});

test("preserves usage on a completed assistant message", () => {
  const tokens = {
    total: 125,
    input: 100,
    output: 20,
    reasoning: 5,
    cache: { read: 10, write: 0 },
  };
  const event = normalizeOpenHarnessEvent(
    {
      type: "message.updated",
      properties: {
        info: {
          id: "m1",
          sessionID: "s1",
          role: "assistant",
          time: { completed: 123 },
          tokens,
        },
      },
    },
    "s1",
  );
  assert.equal(event?.type, "assistant.completed");
  assert.deepEqual(event?.payload.usage, tokens);
});

test("maps permission.asked to permission.requested", () => {
  const event = normalizeOpenHarnessEvent(
    {
      type: "permission.asked",
      properties: { info: { id: "p1", sessionID: "s1", type: "bash", title: "Run tests?" } },
    },
    "s1",
  );
  assert.equal(event?.type, "permission.requested");
  assert.equal(event?.payload.requestId, "p1");
  assert.equal(event?.payload.permission, "bash");
  assert.equal(event?.payload.description, "Run tests?");
});

test("maps session.idle to session.status idle", () => {
  const event = normalizeOpenHarnessEvent({ type: "session.idle", properties: { sessionID: "s1" } }, "s1");
  assert.equal(event?.type, "session.status");
  assert.equal(event?.payload.status, "idle");
});

test("maps session.error to error", () => {
  const event = normalizeOpenHarnessEvent(
    { type: "session.error", properties: { sessionID: "s1", error: { name: "Boom", message: "bad" } } },
    "s1",
  );
  assert.equal(event?.type, "error");
  assert.equal(event?.payload.code, "Boom");
  assert.equal(event?.payload.message, "bad");
});

test("extracts the nested OpenHarness API error message", () => {
  const event = normalizeOpenHarnessEvent(
    {
      type: "session.error",
      properties: {
        sessionID: "s1",
        error: { name: "APIError", data: { message: "Upstream error", statusCode: 400 } },
      },
    },
    "s1",
  );
  assert.equal(event?.type, "error");
  assert.equal(event?.payload.message, "Upstream error");
});

test("returns null for unrelated event types", () => {
  assert.equal(normalizeOpenHarnessEvent({ type: "server.heartbeat", properties: {} }, "s1"), null);
});

test("extractSessionId reads nested part sessions", () => {
  assert.equal(extractSessionId({ type: "x", properties: { part: { sessionID: "sX" } } }), "sX");
  assert.equal(extractSessionId({ type: "x", properties: {} }), undefined);
});

test("encodeSseEvent produces a valid SSE data frame", () => {
  const frame = encodeSseEvent({ type: "session.status", sessionId: "s1", timestamp: "t", payload: { status: "idle" } });
  assert.match(frame, /^data: \{/);
  assert.match(frame, /\n\n$/);
});
