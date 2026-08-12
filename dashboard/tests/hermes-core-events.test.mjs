import test from "node:test";
import assert from "node:assert/strict";
import {
  createHermesEventNormalizationState,
  normalizeHermesEvent,
  extractSessionId,
  encodeSseEvent,
} from "../src/lib/hermes/events.ts";

test("streams assistant text deltas as assistant.delta", () => {
  const event = normalizeHermesEvent(
    {
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        field: "text",
        delta: "Hello",
      },
    },
    "s1",
  );
  assert.equal(event?.type, "assistant.delta");
  assert.equal(event?.payload.text, "Hello");
  assert.equal(event?.messageId, "m1");
});

test("maps reasoning deltas to reasoning.status", () => {
  const event = normalizeHermesEvent(
    {
      type: "message.part.delta",
      properties: { sessionID: "s1", field: "reasoning", delta: "thinking..." },
    },
    "s1",
  );
  assert.equal(event?.type, "reasoning.status");
  assert.equal(event?.payload.detail, "thinking...");
  assert.equal(event?.payload.detailMode, "append");
});

test("keeps structured reasoning-part deltas out of assistant answer text", () => {
  const state = createHermesEventNormalizationState();
  const started = normalizeHermesEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          id: "reasoning-1",
          sessionID: "s1",
          type: "reasoning",
          text: "",
          time: { start: 1 },
        },
      },
    },
    "s1",
    state,
  );
  assert.equal(started?.type, "reasoning.status");

  const summary = normalizeHermesEvent(
    {
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "reasoning-1",
        field: "text",
        delta: "Checking the relevant sources.",
      },
    },
    "s1",
    state,
  );
  assert.equal(summary?.type, "reasoning.status");
  assert.equal(summary?.payload.detail, "Checking the relevant sources.");
});

test("maps a full reasoning-part snapshot as replacement text", () => {
  const event = normalizeHermesEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          id: "reasoning-1",
          sessionID: "s1",
          type: "reasoning",
          text: "I checked the relevant sources and compared the results.",
          time: { start: 1, end: 2 },
        },
      },
    },
    "s1",
  );
  assert.equal(event?.type, "reasoning.status");
  assert.equal(
    event?.payload.detail,
    "I checked the relevant sources and compared the results.",
  );
  assert.equal(event?.payload.detailMode, "replace");
});

test("drops events belonging to a different session", () => {
  const event = normalizeHermesEvent(
    {
      type: "message.part.delta",
      properties: { sessionID: "other", field: "text", delta: "nope" },
    },
    "s1",
  );
  assert.equal(event, null);
});

test("maps a running tool part to tool.started", () => {
  const event = normalizeHermesEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          type: "tool",
          tool: "garden_search",
          callID: "c1",
          state: { status: "running", title: "Searching" },
        },
      },
    },
    "s1",
  );
  assert.equal(event?.type, "tool.started");
  assert.equal(event?.payload.toolName, "garden_search");
  assert.equal(event?.payload.toolCallId, "c1");
});

test("maps a completed tool part to tool.completed success", () => {
  const event = normalizeHermesEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          type: "tool",
          tool: "read",
          callID: "c2",
          state: {
            status: "completed",
            input: { filePath: "C:\\work\\note.md" },
            output: "ok",
          },
        },
      },
    },
    "s1",
  );
  assert.equal(event?.type, "tool.completed");
  assert.equal(event?.payload.success, true);
  assert.equal(event?.payload.location, "C:\\work\\note.md");
});

test("maps an errored tool part to tool.completed failure", () => {
  const event = normalizeHermesEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          type: "tool",
          tool: "bash",
          callID: "c3",
          state: { status: "error", error: "boom" },
        },
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
  const event = normalizeHermesEvent(
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
  const event = normalizeHermesEvent(
    {
      type: "permission.asked",
      properties: {
        info: { id: "p1", sessionID: "s1", type: "bash", title: "Run tests?" },
      },
    },
    "s1",
  );
  assert.equal(event?.type, "permission.requested");
  assert.equal(event?.payload.requestId, "p1");
  assert.equal(event?.payload.permission, "bash");
  assert.equal(event?.payload.description, "Run tests?");
});

test("uses terminal permission metadata for an exact-command approval card", () => {
  const event = normalizeHermesEvent(
    {
      type: "permission.asked",
      properties: {
        info: {
          id: "p-terminal",
          sessionID: "s1",
          permission: "terminal_execute_command",
          metadata: {
            command: "du -sh .",
            description: "Run this command on your computer?",
          },
        },
      },
    },
    "s1",
  );
  assert.equal(event?.payload.description, "Run this command on your computer?");
  assert.equal(event?.payload.command, "du -sh .");
  assert.equal(event?.payload.risk, "execute");
});

test("maps session.idle to session.status idle", () => {
  const event = normalizeHermesEvent(
    { type: "session.idle", properties: { sessionID: "s1" } },
    "s1",
  );
  assert.equal(event?.type, "session.status");
  assert.equal(event?.payload.status, "idle");
});

test("maps session.error to error", () => {
  const event = normalizeHermesEvent(
    {
      type: "session.error",
      properties: { sessionID: "s1", error: { name: "Boom", message: "bad" } },
    },
    "s1",
  );
  assert.equal(event?.type, "error");
  assert.equal(event?.payload.code, "Boom");
  assert.equal(event?.payload.message, "bad");
});

test("extracts the nested Hermes API error message", () => {
  const event = normalizeHermesEvent(
    {
      type: "session.error",
      properties: {
        sessionID: "s1",
        error: {
          name: "APIError",
          data: { message: "Upstream error", statusCode: 400 },
        },
      },
    },
    "s1",
  );
  assert.equal(event?.type, "error");
  assert.equal(event?.payload.message, "Upstream error");
});

test("returns null for unrelated event types", () => {
  assert.equal(
    normalizeHermesEvent(
      { type: "server.heartbeat", properties: {} },
      "s1",
    ),
    null,
  );
});

test("extractSessionId reads nested part sessions", () => {
  assert.equal(
    extractSessionId({ type: "x", properties: { part: { sessionID: "sX" } } }),
    "sX",
  );
  assert.equal(extractSessionId({ type: "x", properties: {} }), undefined);
});

test("encodeSseEvent produces a valid SSE data frame", () => {
  const frame = encodeSseEvent({
    type: "session.status",
    sessionId: "s1",
    timestamp: "t",
    payload: { status: "idle" },
  });
  assert.match(frame, /^data: \{/);
  assert.match(frame, /\n\n$/);
});
