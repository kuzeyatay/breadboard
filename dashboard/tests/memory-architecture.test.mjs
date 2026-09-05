// The memory architecture's load-bearing promises, each one a thing the live
// database showed was not being kept:
//
// - compaction happens because an answer landed, on every surface, not
//   because one particular transport remembered to ask for it;
// - retrieval considers every active memory, so relevance decides what
//   reaches a prompt rather than a recency window nobody chose;
// - a memory that keeps being used stays fresh, and one that never is decays;
// - a derived measurement rewrites its own row instead of leaving a retired
//   copy behind every time the number moves.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-memory-arch-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const memory = await import("../src/lib/conversations/memory.ts");
const autofetch = await import("../src/lib/memory-tree/autofetch.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM memory_tree_links;
    DELETE FROM memory_tree_nodes;
    DELETE FROM memory_tree_state;
    DELETE FROM contacts;
    DELETE FROM durable_memories;
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
});

function conversation(title = "Chat") {
  return store.createConversation({ userId: 1, title });
}

function finishTurn(chat, clientMessageId, surface, userText, assistantText = "Done") {
  store.reserveConversationTurn({
    conversation: chat,
    clientMessageId,
    surface,
    content: userText,
  });
  store.completeAssistantMessage({
    conversationId: chat.id,
    clientMessageId,
    content: assistantText,
  });
}

function remember(content, overrides = {}) {
  return memory.saveDurableMemory({
    userId: 1,
    content,
    kind: "project_fact",
    scope: "global",
    scopeId: null,
    state: "confirmed",
    confidence: 0.9,
    salience: 0.85,
    ...overrides,
  });
}

function backdate(id, days) {
  db.prepare(
    `UPDATE durable_memories
     SET created_at = datetime('now', ?), last_confirmed_at = datetime('now', ?)
     WHERE id = ?`,
  ).run(`-${days} days`, `-${days} days`, id);
}

function row(id) {
  return db.prepare("SELECT * FROM durable_memories WHERE id = ?").get(id);
}

test("completing an answer compacts the transcript on a surface the old hook never covered", () => {
  const chat = conversation("Garden chat");
  for (let index = 0; index < 15; index += 1) {
    finishTurn(
      chat,
      `garden-${String(index).padStart(3, "0")}`,
      "garden_chat",
      index === 0 ? "We decided to keep the pump rig on the bench." : `Question ${index}?`,
      `Answer ${index}.`,
    );
  }
  const state = memory.loadConversationMemoryState(chat.id);
  // Thirty messages, the most recent eighteen kept exact: everything through
  // order index 11 is folded into the summary.
  assert.equal(state.summarizedThroughOrder, 11);
  assert.equal(state.version, 1);
  assert.match(state.summary, /pump rig on the bench/);
  // Nothing left to do afterwards; the seam is idempotent.
  assert.equal(memory.compactConversationMemoryIfNeeded(chat.id), false);
});

test("a compaction failure never fails the answer that triggered it", () => {
  const chat = conversation("Fragile");
  // Only compaction ever advances summarized_through_order, so a trigger on
  // that write makes compaction — and nothing else in the turn — throw.
  db.exec(`
    CREATE TRIGGER fail_compaction BEFORE UPDATE ON conversation_memory_state
    WHEN NEW.summarized_through_order >= 0
    BEGIN SELECT RAISE(ABORT, 'compaction exploded'); END;
  `);
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    for (let index = 0; index < 15; index += 1) {
      finishTurn(chat, `fragile-${index}`, "dashboard_terminal", `Q ${index}?`, `A ${index}.`);
    }
  } finally {
    console.error = originalError;
    db.exec("DROP TRIGGER fail_compaction");
  }
  const last = db
    .prepare(
      "SELECT status FROM conversation_messages WHERE conversation_id = ? ORDER BY order_index DESC LIMIT 1",
    )
    .get(chat.id);
  assert.equal(last.status, "complete");
  assert.ok(
    errors.some((args) => /rolling compaction failed/.test(String(args[0]))),
    "the failure is logged, not swallowed",
  );
  assert.equal(memory.loadConversationMemoryState(chat.id).summarizedThroughOrder, -1);
});

test("retrieval considers every active memory, not the two hundred most recent", () => {
  const relevant = remember("The pump rig runs on twenty-four volts.");
  backdate(relevant.id, 300);
  for (let index = 0; index < 230; index += 1) {
    remember(`Filler fact number ${index} about subject-${index}.`);
  }
  const ranked = memory.retrieveDurableMemories({
    userId: 1,
    currentConversationId: 0,
    query: "pump rig volts",
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, relevant.id);
});

test("a memory that reaches a prompt is stamped and outranks an unused twin", () => {
  const used = remember("The user indents Python with tabs.");
  const unused = remember("The user indents Rust with tabs.");
  backdate(used.id, 400);
  backdate(unused.id, 400);
  const before = memory.retrieveDurableMemories({
    userId: 1,
    currentConversationId: 0,
    query: "indent with tabs",
  });
  assert.equal(before.length, 2);
  assert.equal(before[0].score, before[1].score, "twins tie before either is used");

  memory.touchDurableMemories([used.id]);
  const stamped = row(used.id);
  assert.equal(stamped.retrieval_count, 1);
  assert.ok(stamped.last_retrieved_at);
  assert.equal(memory.memoryRecencyAnchor(stamped), stamped.last_retrieved_at);
  assert.equal(row(unused.id).retrieval_count, 0);

  const after = memory.retrieveDurableMemories({
    userId: 1,
    currentConversationId: 0,
    query: "indent with tabs",
  });
  assert.equal(after[0].id, used.id);
  assert.ok(after[0].score > after[1].score, "use counts as freshness");
});

test("the turn bundle stamps its selection once per load, and not when told not to", () => {
  const saved = remember("The user indents Python with tabs.");
  const chat = conversation("Current");
  const load = (touch) =>
    memory.loadConversationMemoryBundle({
      conversation: chat,
      query: "how should I indent these Python tabs",
      ...(touch === undefined ? {} : { touch }),
    });
  assert.equal(load().durableMemories[0].id, saved.id);
  assert.equal(row(saved.id).retrieval_count, 1);
  load();
  assert.equal(row(saved.id).retrieval_count, 2);
  load(false);
  assert.equal(row(saved.id).retrieval_count, 2, "the hybrid loader stamps the final set itself");
});

test("a keyed save can rewrite its row in place instead of retiring it", () => {
  const first = remember("The project has 3 open tasks.", {
    memoryKey: "autofetch:test:count",
    state: "candidate",
    onKeyConflict: "replace",
  });
  const second = remember("The project has 4 open tasks.", {
    memoryKey: "autofetch:test:count",
    state: "candidate",
    onKeyConflict: "replace",
  });
  assert.equal(second.id, first.id);
  assert.equal(row(first.id).content, "The project has 4 open tasks.");
  assert.equal(row(first.id).state, "candidate");
  const superseded = db
    .prepare("SELECT COUNT(*) AS n FROM durable_memories WHERE state = 'superseded'")
    .get().n;
  assert.equal(superseded, 0);

  // The default still keeps the user's earlier statement as history.
  const stated = remember("My editor is Vim.", { memoryKey: "preference:subject:editor" });
  const restated = remember("My editor is Helix.", { memoryKey: "preference:subject:editor" });
  assert.notEqual(restated.id, stated.id);
  assert.equal(row(stated.id).state, "superseded");
});

test("purging retired autofetch rows leaves the user's own history alone", () => {
  remember("Old count 1.", { memoryKey: "autofetch:test:a", state: "candidate" });
  remember("Old count 2.", { memoryKey: "autofetch:test:a", state: "candidate" });
  remember("My editor is Vim.", { memoryKey: "preference:subject:editor" });
  remember("My editor is Helix.", { memoryKey: "preference:subject:editor" });
  assert.equal(autofetch.purgeSupersededAutofetchRows(1), 1);
  const remaining = db
    .prepare(
      "SELECT memory_key, state FROM durable_memories WHERE state = 'superseded' ORDER BY id",
    )
    .all();
  assert.deepEqual(remaining, [{ memory_key: "preference:subject:editor", state: "superseded" }]);
});

test("the heartbeat updates a changed count in place and cleans up after itself", () => {
  const addContact = (name) =>
    db
      .prepare("INSERT INTO contacts(user_id, name, organization) VALUES (1, ?, 'Acme')")
      .run(name);
  addContact("Ada");
  addContact("Grace");
  addContact("Linus");
  const first = autofetch.autofetchForUser(1);
  assert.equal(first.written, 1);
  const rows = () =>
    db
      .prepare(
        "SELECT id, content, state FROM durable_memories WHERE memory_key = 'autofetch:contacts:org:acme' ORDER BY id",
      )
      .all();
  assert.equal(rows().length, 1);
  assert.match(rows()[0].content, /3 people at Acme/);

  addContact("Margaret");
  autofetch.autofetchForUser(1);
  const after = rows();
  assert.equal(after.length, 1, "no retired copy per tick");
  assert.equal(after[0].id, first ? rows()[0].id : undefined);
  assert.match(after[0].content, /4 people at Acme/);
  assert.equal(after[0].state, "candidate");
});
