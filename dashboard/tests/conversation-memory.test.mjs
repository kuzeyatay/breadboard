import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import Database from "better-sqlite3";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-conversations-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const schema = await import("../src/lib/conversations/schema.ts");
const store = await import("../src/lib/conversations/store.ts");
const memory = await import("../src/lib/conversations/memory.ts");
const runtime = await import("../src/lib/openharness/runtime-store.ts");
const capability = await import("../src/lib/openharness/capability-token.ts");
const gardenTools = await import("../src/lib/openharness/garden-tools.ts");
const toolScopes = await import("../src/lib/openharness/tool-scopes.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM openharness_runtime_sessions;
    DELETE FROM durable_memories;
    DELETE FROM conversations;
    DELETE FROM clusters;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')").run();
  db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (2, 'bob', 'bob@example.test', 'x')").run();
  db.prepare("INSERT INTO clusters(id, user_id, name, slug, visibility, chat_accessible) VALUES (10, 1, 'Aurora Garden', 'aurora', 'private', 0)").run();
});

function conversation(userId = 1, title = "New chat") {
  return store.createConversation({ userId, title });
}

test("active Agency Agent selection is isolated per conversation and can be cleared", () => {
  const first = conversation(1, "First");
  const second = conversation(1, "Second");
  const selected = store.updateConversation(first, {
    activeAgencyAgentSlug: "frontend-developer",
  });
  assert.equal(selected.active_agency_agent_slug, "frontend-developer");
  assert.equal(store.getConversationById(second.id).active_agency_agent_slug, null);
  const presented = store.presentConversation(selected);
  assert.equal(presented.activeAgencyAgentSlug, "frontend-developer");
  assert.equal(
    store.updateConversation(selected, { activeAgencyAgentSlug: null })
      .active_agency_agent_slug,
    null,
  );
});

function finishTurn(conversationRow, clientMessageId, surface, userText, assistantText = "Done") {
  const reserved = store.reserveConversationTurn({
    conversation: conversationRow,
    clientMessageId,
    surface,
    content: userText,
  });
  store.completeAssistantMessage({
    conversationId: conversationRow.id,
    clientMessageId,
    content: assistantText,
  });
  return reserved;
}

test("same conversation has exact cross-surface continuity", () => {
  const chat = conversation();
  finishTurn(chat, "terminal-aurora-001", "dashboard_terminal", "My temporary project codename is Aurora.");
  finishTurn(chat, "garden-question-001", "garden_chat", "What project codename did I give you?", "Aurora.");

  const bundle = memory.loadConversationMemoryBundle({
    conversation: chat,
    query: "What was the codename?",
    activeGardenId: 10,
    projectScopeId: "breadboard",
  });
  assert.match(bundle.recentMessages.map((message) => message.content).join("\n"), /Aurora/);

  finishTurn(chat, "quartz-followup-001", "quartz_ai", "Keep using that codename.");
  assert.deepEqual(
    [...new Set(store.listConversationMessages(chat.id).map((message) => message.surface))],
    ["dashboard_terminal", "garden_chat", "quartz_ai"],
  );
});

test("different conversations never receive each other's transcript", () => {
  const chatA = conversation(1, "Chat A");
  const chatB = conversation(1, "Chat B");
  finishTurn(chatA, "chat-a-aurora-001", "dashboard_terminal", "The codename is Aurora.");
  finishTurn(chatB, "chat-b-question-01", "dashboard_terminal", "What is the codename?");

  const bundle = memory.loadConversationMemoryBundle({
    conversation: chatB,
    query: "codename",
    projectScopeId: "breadboard",
  });
  assert.doesNotMatch(bundle.recentMessages.map((message) => message.content).join("\n"), /Aurora/);
});

test("durable memory is weak, selective, and current-chat text wins", () => {
  const source = conversation(1, "Preferences");
  memory.saveDurableMemory({
    userId: 1,
    content: "Prefer React for project UI work.",
    kind: "preference",
    scope: "project",
    scopeId: "breadboard",
    sourceConversationId: source.id,
    state: "confirmed",
    confidence: 0.95,
    salience: 0.9,
    memoryKey: "ui-framework",
  });
  const current = conversation(1, "Current work");
  finishTurn(current, "current-no-react-01", "dashboard_terminal", "Do not use React for this component.");
  const bundle = memory.loadConversationMemoryBundle({
    conversation: current,
    query: "React component UI",
    projectScopeId: "breadboard",
  });
  assert.equal(bundle.durableMemories.length, 1);
  assert.ok(bundle.durableMemories[0].score < 0.55, "durable score remains below project scope weight");
  const context = memory.composeMemoryContext(bundle);
  assert.ok(context.indexOf("Do not use React") < context.indexOf("Prefer React"));
  assert.match(context, /current user instruction > current conversation exact messages/);
});

test("explicit remember promotes, secrets never do, and changed keys supersede", () => {
  const chat = conversation();
  const first = memory.maintainDurableMemoryFromUserTurn({
    conversation: chat,
    content: "Please remember globally: I prefer concise status updates.",
  });
  assert.equal(first?.state, "confirmed");
  assert.equal(first?.scope, "global");
  const secret = memory.maintainDurableMemoryFromUserTurn({
    conversation: chat,
    content: "Remember globally: my API key is sk-example-secret-123456789.",
  });
  assert.equal(secret, null);

  const old = memory.saveDurableMemory({
    userId: 1,
    content: "Prefer React.",
    kind: "preference",
    scope: "project",
    scopeId: "breadboard",
    sourceConversationId: chat.id,
    state: "confirmed",
    confidence: 0.9,
    salience: 0.8,
    memoryKey: "framework",
  });
  memory.saveDurableMemory({
    userId: 1,
    content: "Prefer Svelte.",
    kind: "preference",
    scope: "project",
    scopeId: "breadboard",
    sourceConversationId: chat.id,
    state: "confirmed",
    confidence: 0.9,
    salience: 0.8,
    memoryKey: "framework",
  });
  assert.equal(db.prepare("SELECT state FROM durable_memories WHERE id = ?").get(old.id).state, "superseded");
});

test("client retries deduplicate and simultaneous turns are serialized", () => {
  const chat = conversation();
  const first = store.reserveConversationTurn({
    conversation: chat,
    clientMessageId: "retry-message-001",
    surface: "dashboard_terminal",
    content: "Hello",
  });
  const retry = store.reserveConversationTurn({
    conversation: chat,
    clientMessageId: "retry-message-001",
    surface: "dashboard_terminal",
    content: "Hello",
  });
  assert.equal(first.isNew, true);
  assert.equal(retry.isNew, false);
  assert.throws(
    () => store.reserveConversationTurn({
      conversation: chat,
      clientMessageId: "parallel-message-02",
      surface: "garden_chat",
      content: "A simultaneous request",
    }),
    (error) => error.code === "conversation_turn_active",
  );
  store.completeAssistantMessage({
    conversationId: chat.id,
    clientMessageId: "retry-message-001",
    content: "Hello back",
  });
  store.completeAssistantMessage({
    conversationId: chat.id,
    clientMessageId: "retry-message-001",
    content: "Duplicate should not replace",
  });
  const rows = store.listConversationMessages(chat.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.order_index), [0, 1]);
  assert.equal(rows[1].content, "Hello back");
});

test("course correction is inserted before the pending assistant deterministically", () => {
  const chat = conversation();
  store.reserveConversationTurn({
    conversation: chat,
    clientMessageId: "original-message-01",
    surface: "dashboard_terminal",
    content: "Initial request",
  });
  store.appendConversationSteerMessage({
    conversationId: chat.id,
    clientMessageId: "steer:request-0001",
    surface: "dashboard_terminal",
    content: "Use the newer file instead.",
  });
  const rows = store.listConversationMessages(chat.id);
  assert.deepEqual(rows.map((row) => [row.role, row.order_index]), [
    ["user", 0],
    ["user", 1],
    ["assistant", 2],
  ]);
});

test("one runtime is bound per conversation and active context is replaced", () => {
  const first = conversation(1, "First");
  const second = conversation(1, "Second");
  const runtimeA = runtime.createRuntimeSession({
    conversationId: first.id,
    surface: "garden_chat",
    userId: 1,
    chatSessionId: null,
    agentName: "breadboard-assistant",
    clusterId: 10,
    gardenId: "aurora",
    pageSlug: null,
    allowedGardenIds: [10],
    workspaceKey: "conversations/a",
    activeDirectory: dataRoot,
    filesystemMode: "restricted",
    openHarnessSessionId: "oh-a",
  });
  const runtimeB = runtime.createRuntimeSession({
    conversationId: second.id,
    surface: "dashboard_terminal",
    userId: 1,
    chatSessionId: null,
    agentName: "breadboard-assistant",
    clusterId: null,
    gardenId: null,
    pageSlug: null,
    allowedGardenIds: [10],
    workspaceKey: "conversations/b",
    activeDirectory: dataRoot,
    filesystemMode: "restricted",
    openHarnessSessionId: "oh-b",
  });
  assert.equal(runtime.getRuntimeSessionByConversation(first.id).id, runtimeA.id);
  assert.notEqual(runtimeA.openharness_session_id, runtimeB.openharness_session_id);
  const terminal = runtime.updateRuntimeActiveContext({
    runtimeSessionId: runtimeA.id,
    surface: "dashboard_terminal",
    clusterId: null,
    gardenId: null,
    pageSlug: null,
    allowedGardenIds: [10],
  });
  assert.equal(terminal.garden_id, null);
  assert.equal(terminal.page_slug, null);
});

test("ownership is indistinguishable from a missing opaque id", () => {
  const chat = conversation(1);
  assert.throws(
    () => store.getConversationForUser(chat.public_id, 2),
    (error) => error.status === 404 && error.code === "conversation_not_found",
  );
});

test("workspace tools expose only the signed server-authorized garden set", async () => {
  db.prepare("INSERT INTO clusters(id, user_id, name, slug, visibility, chat_accessible) VALUES (11, 2, 'Bob Garden', 'bob-private', 'private', 0)").run();
  const token = capability.issueCapabilityToken({
    userId: 1,
    conversationId: conversation().id,
    surface: "dashboard_terminal",
    openHarnessSessionId: "oh-authorized-set",
    allowedGardenIds: [10],
    activeGardenId: 10,
    allowedTools: [...toolScopes.GARDEN_TOOLS],
  });

  const listed = await gardenTools.executeGardenTool({ rawToken: token, tool: "garden_list", args: {} });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.data.gardens, [{ id: 10, slug: "aurora", name: "Aurora Garden" }]);

  const escaped = await gardenTools.executeGardenTool({
    rawToken: token,
    tool: "garden_get_page",
    args: { gardenId: "bob-private", slug: "anything" },
  });
  assert.equal(escaped.ok, false);
  assert.match(escaped.error, /outside.*authorized/i);
});

test("rolling compaction advances once and retains recent exact messages", () => {
  const chat = conversation();
  for (let index = 0; index < 18; index += 1) {
    finishTurn(
      chat,
      `compaction-turn-${String(index).padStart(3, "0")}`,
      index % 2 ? "garden_chat" : "dashboard_terminal",
      index === 0
        ? "We decided to keep the canonical server transcript."
        : index === 5
          ? "Open question: Which database should own future migrations?"
          : `Question ${index}?`,
      index === 1 ? "Implemented the transcript store." : `Answer ${index}.`,
    );
  }
  assert.equal(memory.compactConversationMemoryIfNeeded(chat.id), true);
  const state = memory.loadConversationMemoryState(chat.id);
  assert.ok(state.summarizedThroughOrder >= 0);
  assert.match(state.summary, /canonical server transcript/);
  assert.ok(state.workingState.openQuestions.some((question) => /future migrations/i.test(question)));
  assert.equal(memory.compactConversationMemoryIfNeeded(chat.id), false);
  const recent = memory.loadConversationMemoryBundle({ conversation: chat, query: "latest" }).recentMessages;
  assert.ok(recent.length <= 24);
  assert.equal(recent.at(-1).content, "Answer 17.");
});

test("legacy backfill is repeatable and preserves order without duplicates", () => {
  const legacy = new Database(":memory:");
  legacy.pragma("foreign_keys = ON");
  seedLegacySchema(legacy);
  legacy.prepare("INSERT INTO users VALUES (1, 'alice', 'alice@example.test', 'x')").run();
  legacy.prepare("INSERT INTO clusters(id, user_id, name, slug, visibility, chat_accessible) VALUES (10, 1, 'A', 'a', 'private', 0)").run();
  legacy.prepare("INSERT INTO chat_sessions(id, cluster_id, user_id, title, created_at, updated_at) VALUES (20, 10, 1, 'Old chat', '2025-01-01', '2025-01-02')").run();
  legacy.prepare("INSERT INTO chat_messages(id, session_id, role, content, order_index, created_at) VALUES (30, 20, 'user', 'first', 0, '2025-01-01')").run();
  legacy.prepare("INSERT INTO chat_messages(id, session_id, role, content, order_index, created_at) VALUES (31, 20, 'assistant', 'second', 1, '2025-01-01')").run();
  schema.ensureConversationSchema(legacy);
  schema.ensureConversationSchema(legacy);
  assert.equal(legacy.prepare("SELECT COUNT(*) AS count FROM conversations").get().count, 1);
  const copied = legacy.prepare("SELECT content, order_index FROM conversation_messages ORDER BY order_index").all();
  assert.deepEqual(copied, [
    { content: "first", order_index: 0 },
    { content: "second", order_index: 1 },
  ]);
  assert.equal(legacy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  legacy.close();
});

function seedLegacySchema(database) {
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, email TEXT, password_hash TEXT);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, slug TEXT, visibility TEXT, chat_accessible INTEGER);
    CREATE TABLE chat_sessions(id INTEGER PRIMARY KEY, cluster_id INTEGER, user_id INTEGER, title TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE chat_messages(
      id INTEGER PRIMARY KEY, session_id INTEGER, role TEXT, content TEXT, sources TEXT,
      token_usage TEXT, order_index INTEGER, created_at TEXT, tool_calls TEXT,
      permission_decisions TEXT, runtime_error TEXT, runtime_status TEXT, proposal TEXT
    );
    CREATE TABLE openharness_runtime_sessions(
      id INTEGER PRIMARY KEY, surface TEXT, user_id INTEGER, chat_session_id INTEGER,
      openharness_session_id TEXT, agent_name TEXT, cluster_id INTEGER, garden_id TEXT,
      page_slug TEXT, workspace_key TEXT, active_directory TEXT, filesystem_mode TEXT,
      capability_mode TEXT, capability_decision_id INTEGER, runtime_metadata TEXT,
      last_runtime_status TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE openharness_messages(
      id INTEGER PRIMARY KEY, runtime_session_id INTEGER, role TEXT, content TEXT,
      sources TEXT, token_usage TEXT, tool_calls TEXT, permission_decisions TEXT,
      runtime_error TEXT, runtime_status TEXT, proposal TEXT, order_index INTEGER, created_at TEXT
    );
  `);
}
