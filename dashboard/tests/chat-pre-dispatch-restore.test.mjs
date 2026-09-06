import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "breadboard-chat-restore-"),
);
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const presentation = await import(
  "../src/lib/hermes/session-presentation.ts"
);

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM hermes_runtime_sessions;
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
});

function createInitialTurn(responseStartedAt) {
  return store.createConversationWithInitialTurn({
    conversation: {
      userId: 1,
      title: "New chat",
      surface: "dashboard_terminal",
    },
    turn: {
      clientMessageId: "first-turn",
      surface: "dashboard_terminal",
      content: "hi",
      metadata: {
        responseStartedAt,
        preDispatchRecovery: {
          agentMode: true,
          model: "openai/gpt-5.6",
          reasoningEffort: "high",
          superAgent: false,
          adhdMode: false,
          personalize: true,
          yoloMode: false,
        },
      },
    },
  });
}

function presentedAssistant(conversation) {
  return presentation
    .presentHermesSessionDetail(conversation)
    .messages.find((message) => message.role === "assistant");
}

test("failed replies restore their diagnostics separately from answer content", () => {
  for (const field of ["error", "runtimeError"]) {
    const { conversation } = createInitialTurn(new Date().toISOString());
    store.retryAssistantMessage(conversation.id, "first-turn");
    store.failAssistantMessage({
      conversationId: conversation.id,
      clientMessageId: "first-turn",
      status: "failed",
      metadata: { [field]: "system_prompt is too large" },
    });
    const assistant = presentedAssistant(conversation);
    assert.equal(assistant.failed, true);
    assert.equal(assistant.content, "");
    assert.equal(assistant.runtimeError, "system_prompt is too large");
    assert.equal(assistant.metadata, undefined, "restore does not expose the full persistence envelope");
  }
});

test("reopening a newly-created chat during dispatch still shows the original Thinking turn", () => {
  const responseStartedAt = new Date().toISOString();
  const created = createInitialTurn(responseStartedAt);

  // The database sentinel remains aborted so a process crash is recoverable.
  assert.equal(created.turn.assistantMessage.status, "aborted");

  const assistant = presentedAssistant(created.conversation);
  assert.equal(assistant.pending, true);
  assert.equal(assistant.interrupted, false);
  assert.equal(assistant.responseStartedAt, responseStartedAt);
  assert.equal(assistant.responseDurationMs, undefined);
  assert.deepEqual(assistant.preDispatchRecovery, {
    agentMode: true,
    model: "openai/gpt-5.6",
    reasoningEffort: "high",
    superAgent: false,
    adhdMode: false,
    personalize: true,
    yoloMode: false,
  });
});

test("a genuinely abandoned pre-dispatch placeholder eventually becomes interrupted", () => {
  const created = createInitialTurn(
    new Date(Date.now() - 6 * 60 * 1_000).toISOString(),
  );
  const assistant = presentedAssistant(created.conversation);

  assert.equal(assistant.pending, false);
  assert.equal(assistant.interrupted, true);
  assert.equal(assistant.preDispatchRecovery, undefined);
});

test("claiming the placeholder preserves the send timestamp used by the restored clock", () => {
  const originalStartedAt = new Date().toISOString();
  const created = createInitialTurn(originalStartedAt);
  store.retryAssistantMessage(
    created.conversation.id,
    "first-turn",
    undefined,
    { responseStartedAt: originalStartedAt },
  );

  const assistant = presentedAssistant(created.conversation);
  assert.equal(assistant.pending, true);
  assert.equal(assistant.interrupted, false);
  assert.equal(assistant.responseStartedAt, originalStartedAt);
  assert.equal(assistant.preDispatchRecovery, undefined);
});
