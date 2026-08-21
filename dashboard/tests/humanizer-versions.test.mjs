// Content versions of an assistant answer, against a real database.
//
// The promise this feature makes to a reader is narrow and absolute: adopting a
// rewrite adds a version, and the answer the model actually produced is still
// there afterwards. Everything below is that promise, plus the ways a rewrite
// can arrive too late to be applied safely.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-humanizer-versions-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const versions = await import("../src/lib/conversations/message-versions.ts");
const schemas = await import("../src/lib/humanizer/schemas.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM conversations;
    DELETE FROM clusters;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
});

const ORIGINAL =
  "The system represents a groundbreaking step forward in local knowledge software.";
const REWRITE = "The system is a real step up for local knowledge software.";

let clientMessageCounter = 0;

/** A finished turn, the way a completed answer actually lands in the table. */
function completedTurn(content = ORIGINAL) {
  clientMessageCounter += 1;
  const conversation = store.createConversation({ userId: 1, title: "Rewrite me" });
  const reserved = store.reserveConversationTurn({
    conversation,
    clientMessageId: `client-message-${clientMessageCounter}`,
    surface: "dashboard_terminal",
    content: "say something",
  });
  const assistant = store.completeAssistantMessage({
    conversationId: conversation.id,
    clientMessageId: reserved.userMessage.client_message_id,
    content,
    metadata: { verification: { state: "verified", evidence: [] } },
  });
  return { conversation, assistant };
}

function reload(id) {
  return store.getConversationMessageById(id);
}

test("an answer that was never rewritten still reports one version", () => {
  const { assistant } = completedTurn();
  const state = versions.readMessageVersions(assistant);
  assert.equal(state.versions.length, 1);
  assert.equal(state.activeIndex, 0);
  assert.equal(state.derived, false);
  assert.equal(state.versions[0].content, ORIGINAL);
  assert.equal(state.versions[0].origin, "original");
});

test("a live client message id resolves the same assistant row before reload", () => {
  const { conversation, assistant } = completedTurn();
  const parsed = schemas.parseRequest(schemas.applyRewriteSchema, {
    conversationId: `conv_${conversation.id}`,
    messageId: assistant.client_message_id,
    expectedContent: ORIGINAL,
    rewrittenText: REWRITE,
  });
  assert.equal(parsed.ok, true);
  const resolved = store.getConversationMessageByClientId(
    conversation.id,
    assistant.client_message_id,
    "assistant",
  );
  assert.equal(resolved?.id, assistant.id);
});

test("applying a rewrite keeps the original and selects the new version", () => {
  const { conversation, assistant } = completedTurn();
  const state = versions.addAssistantContentVersion({
    conversationId: conversation.id,
    messageId: assistant.id,
    expectedContent: ORIGINAL,
    content: REWRITE,
    origin: "humanizer",
  });

  assert.equal(state.versions.length, 2);
  assert.equal(state.activeIndex, 1);
  assert.equal(state.derived, true);
  assert.equal(state.versions[0].content, ORIGINAL, "the original must survive verbatim");
  assert.equal(state.versions[0].origin, "original");
  assert.equal(state.versions[1].content, REWRITE);
  assert.equal(state.versions[1].derivedFrom, 0);

  // The row's content column mirrors the active version, because every other
  // reader in the codebase reads that column.
  assert.equal(reload(assistant.id).content, REWRITE);
});

test("an adopted rewrite keeps its compact score for transcript reloads", () => {
  const { conversation, assistant } = completedTurn();
  const review = {
    original: 22,
    rewrite: 7,
    delta: -15,
    tied: false,
    worsened: false,
  };
  versions.addAssistantContentVersion({
    conversationId: conversation.id,
    messageId: assistant.id,
    expectedContent: ORIGINAL,
    content: REWRITE,
    origin: "humanizer",
    review,
  });

  const restored = versions.readMessageVersions(reload(assistant.id));
  assert.deepEqual(restored.versions[1].review, review);
  assert.deepEqual(versions.presentMessageVersions(restored).review, review);
});

test("the original stays selectable after a rewrite", () => {
  const { conversation, assistant } = completedTurn();
  versions.addAssistantContentVersion({
    conversationId: conversation.id,
    messageId: assistant.id,
    expectedContent: ORIGINAL,
    content: REWRITE,
    origin: "humanizer",
  });
  const back = versions.selectAssistantContentVersion({
    conversationId: conversation.id,
    messageId: assistant.id,
    index: 0,
  });
  assert.equal(back.activeIndex, 0);
  assert.equal(back.derived, false);
  assert.equal(reload(assistant.id).content, ORIGINAL);
  // Both are still there; switching selects, it does not discard.
  assert.equal(back.versions.length, 2);
});

test("a rewrite of content the message no longer holds is refused", () => {
  const { conversation, assistant } = completedTurn();
  assert.throws(
    () =>
      versions.addAssistantContentVersion({
        conversationId: conversation.id,
        messageId: assistant.id,
        expectedContent: "something this message never said",
        content: REWRITE,
        origin: "humanizer",
      }),
    (error) => error.code === "message_content_stale" && error.status === 409,
  );
  // Nothing was written.
  assert.equal(reload(assistant.id).content, ORIGINAL);
  assert.equal(versions.readMessageVersions(reload(assistant.id)).versions.length, 1);
});

test("a rewrite identical to a stored version is refused rather than duplicated", () => {
  const { conversation, assistant } = completedTurn();
  assert.throws(
    () =>
      versions.addAssistantContentVersion({
        conversationId: conversation.id,
        messageId: assistant.id,
        expectedContent: ORIGINAL,
        content: ORIGINAL,
        origin: "humanizer",
      }),
    (error) => error.code === "duplicate_version",
  );
});

test("an empty rewrite is refused", () => {
  const { conversation, assistant } = completedTurn();
  assert.throws(
    () =>
      versions.addAssistantContentVersion({
        conversationId: conversation.id,
        messageId: assistant.id,
        expectedContent: ORIGINAL,
        content: "   ",
        origin: "humanizer",
      }),
    (error) => error.code === "empty_rewrite",
  );
});

test("a user message cannot be rewritten this way", () => {
  const conversation = store.createConversation({ userId: 1, title: "Rewrite me" });
  const reserved = store.reserveConversationTurn({
    conversation,
    clientMessageId: "client-message-user-only",
    surface: "dashboard_terminal",
    content: "a question",
  });
  assert.throws(
    () =>
      versions.addAssistantContentVersion({
        conversationId: conversation.id,
        messageId: reserved.userMessage.id,
        expectedContent: "a question",
        content: "a nicer question",
        origin: "humanizer",
      }),
    (error) => error.code === "message_not_assistant",
  );
});

test("a message from another conversation is simply not found", () => {
  const first = completedTurn();
  const second = completedTurn("a different answer entirely");
  assert.throws(
    () =>
      versions.addAssistantContentVersion({
        conversationId: second.conversation.id,
        messageId: first.assistant.id,
        expectedContent: ORIGINAL,
        content: REWRITE,
        origin: "humanizer",
      }),
    (error) => error.code === "message_not_found" && error.status === 404,
  );
});

test("versions are capped", () => {
  const { conversation, assistant } = completedTurn();
  let current = ORIGINAL;
  for (let index = 1; index < versions.MAX_CONTENT_VERSIONS; index += 1) {
    const next = `${REWRITE} (${index})`;
    versions.addAssistantContentVersion({
      conversationId: conversation.id,
      messageId: assistant.id,
      expectedContent: current,
      content: next,
      origin: "humanizer",
    });
    current = next;
  }
  assert.throws(
    () =>
      versions.addAssistantContentVersion({
        conversationId: conversation.id,
        messageId: assistant.id,
        expectedContent: current,
        content: "one too many",
        origin: "humanizer",
      }),
    (error) => error.code === "too_many_versions",
  );
});

test("a rewritten answer does not inherit the original's verification evidence", async () => {
  const presentation = await import("../src/lib/hermes/session-presentation.ts");
  const { conversation, assistant } = completedTurn();

  const before = presentation.presentHermesSessionDetail(
    store.getConversationById(conversation.id),
  );
  const originalRow = before.messages.find((message) => message.id === `msg_${assistant.id}`);
  assert.ok(originalRow.verification, "the original answer keeps the evidence it earned");

  versions.addAssistantContentVersion({
    conversationId: conversation.id,
    messageId: assistant.id,
    expectedContent: ORIGINAL,
    content: REWRITE,
    origin: "humanizer",
  });

  const after = presentation.presentHermesSessionDetail(
    store.getConversationById(conversation.id),
  );
  const rewritten = after.messages.find((message) => message.id === `msg_${assistant.id}`);
  assert.equal(rewritten.content, REWRITE);
  assert.equal(
    rewritten.verification,
    undefined,
    "evidence describes the original wording, not a later rewrite of it",
  );
  assert.equal(rewritten.contentVersions.total, 2);
  assert.equal(rewritten.contentVersions.derived, true);

  // Selecting the original brings the evidence back with it.
  versions.selectAssistantContentVersion({
    conversationId: conversation.id,
    messageId: assistant.id,
    index: 0,
  });
  const restored = presentation.presentHermesSessionDetail(
    store.getConversationById(conversation.id),
  );
  const back = restored.messages.find((message) => message.id === `msg_${assistant.id}`);
  assert.ok(back.verification);
  assert.equal(back.contentVersions.activeIndex, 0);
});
