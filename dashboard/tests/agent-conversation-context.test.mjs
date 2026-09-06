import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-context-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const turns = await import("../src/lib/conversations/external-agent-turns.ts");
const context = await import("../src/lib/conversations/agent-context.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM chat_sessions;
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
});

function conversation() {
  return store.createConversation({
    userId: 1,
    title: "Assistant conversation",
    surface: "dashboard_terminal",
  });
}

/** One completed exchange, written the way a normal Hermes turn writes it. */
function exchange(row, clientMessageId, userText, assistantText) {
  store.reserveConversationTurn({
    conversation: row,
    clientMessageId,
    surface: "dashboard_terminal",
    content: userText,
  });
  store.completeAssistantMessage({
    conversationId: row.id,
    clientMessageId,
    content: assistantText,
  });
}

test("an opening turn keeps the exact instruction it had before", () => {
  const row = conversation();
  assert.equal(context.withConversationContext("fix the parser", row), "fix the parser");
  assert.equal(context.withConversationContext("fix the parser", null), "fix the parser");
});

test("prior turns reach the agent, oldest first, with the task last", () => {
  const row = conversation();
  exchange(row, "message-0001", "Which memory seams are lossy?", "Compaction is lossy in one direction.");

  const prompt = context.withConversationContext("yes", row);
  assert.match(prompt, /## Conversation so far/);
  assert.match(prompt, /User: Which memory seams are lossy\?/);
  assert.match(prompt, /Assistant: Compaction is lossy in one direction\./);
  assert.match(prompt, /## Your task\n\nyes$/);
  // The exchange has to precede the task, or the agent reads its own brief first.
  assert.ok(prompt.indexOf("Which memory seams") < prompt.indexOf("## Your task"));
});

test("the launching turn is not repeated back as its own context", () => {
  const row = conversation();
  exchange(row, "message-0001", "Which memory seams are lossy?", "Compaction is lossy in one direction.");
  // The surfaces that record the turn before calling the run route.
  turns.recordExternalAgentTurn({
    conversation: row,
    clientMessageId: "message-0002",
    surface: "dashboard_terminal",
    userContent: "/agents:codex yes",
    run: { kind: "codex", runId: "cx-1", task: "yes", gardenSlug: "g", repository: "r" },
  });

  const prompt = context.withConversationContext("yes", row, { clientMessageId: "message-0002" });
  assert.ok(!prompt.includes("/agents:codex yes"));
  assert.match(prompt, /User: Which memory seams are lossy\?/);
});

test("a finished agent run is visible to the next agent", () => {
  const row = conversation();
  turns.recordExternalAgentTurn({
    conversation: row,
    clientMessageId: "message-0001",
    surface: "dashboard_terminal",
    userContent: "/agents:codex add the health check",
    run: { kind: "codex", runId: "cx-1", task: "add the health check", gardenSlug: "g", repository: "r" },
  });
  turns.finishExternalAgentTurn({
    conversationId: row.id,
    clientMessageId: "message-0001",
    outcome: "completed",
    content: "Added the health check to repository-status.ts.",
  });

  const prompt = context.withConversationContext("now test it", row, { clientMessageId: "message-0002" });
  assert.match(prompt, /Assistant: Added the health check to repository-status\.ts\./);
});

test("a long exchange is trimmed from its oldest end, never its newest", () => {
  const row = conversation();
  for (let index = 0; index < 12; index += 1) {
    exchange(row, `message-${String(index).padStart(4, "0")}`, `question ${index} ${"x".repeat(900)}`, `answer ${index}`);
  }
  const prompt = context.withConversationContext("yes", row, { maxChars: 2500 });
  assert.ok(context.conversationContextTranscript(row, { maxChars: 2500 }).length <= 2500);
  assert.match(prompt, /answer 11/);
  assert.ok(!prompt.includes("question 0 "));
});

test("an oversized single message is clipped rather than dropped", () => {
  const row = conversation();
  exchange(row, "message-0001", "short", `Beginning ${"y".repeat(30_000)} final conclusion`);
  const prompt = context.withConversationContext("continue", row);
  assert.match(prompt, /\[\.\.\.\]/);
  assert.match(prompt, /Beginning/);
  assert.match(prompt, /final conclusion/);
  assert.ok(context.conversationContextTranscript(row).length <= 15_000);
  assert.match(prompt, /## Your task\n\ncontinue$/);
});

test("the latest response keeps the option beyond the old per-message cutoff", () => {
  const row = conversation();
  const answer = `First option: refactor.\n${"Details. ".repeat(600)}\nSecond option: replace the cache.`;
  exchange(row, "message-0001", "Compare two options", answer);
  const prompt = context.withConversationContext("based on the chat above, do the second option", row);
  assert.ok(prompt.includes(answer), "the complete latest response should reach the agent");
  assert.match(prompt, /# references_to_chat_messages/);
});

test("a delegated result and its parent answer both reach the next agent", () => {
  const row = conversation();
  exchange(row, "message-0001", "Compare options", "Here is the comparison.");
  db.prepare("UPDATE conversation_messages SET metadata = ? WHERE conversation_id = ? AND role = 'assistant'")
    .run(JSON.stringify({
      externalAgent: true,
      delegatedAgentRun: true,
      delegatedAgentPreamble: "Here is the comparison.",
      externalAgentResult: "The second option replaces the cache.",
    }), row.id);
  const prompt = context.withConversationContext("do the second option", row);
  assert.match(prompt, /Here is the comparison/);
  assert.match(prompt, /The second option replaces the cache/);
});

test("a conversation the user does not own yields no context", () => {
  const row = conversation();
  exchange(row, "message-0001", "secret question", "secret answer");
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (2, 'bob', 'bob@example.test', 'x')",
  ).run();
  const resolved = context.contextConversationFromBody(2, { conversationId: row.public_id });
  assert.equal(resolved, null);
});

test("an unresolvable chat degrades to no context instead of throwing", () => {
  assert.equal(context.contextConversationFromBody(1, {}), null);
  assert.equal(context.contextConversationFromBody(1, { conversationId: "nope" }), null);
  assert.equal(context.contextConversationFromBody(1, { chatSessionId: 9999 }), null);
});
