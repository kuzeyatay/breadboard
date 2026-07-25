import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// Deleting a chat is the one destructive operation on the durable transcript.
// These tests pin the cascade semantics it relies on (so a future schema change
// cannot silently start orphaning or over-deleting rows) and the surface
// contract of the route and the two Recents lists that call it.

const routeSource = fs.readFileSync(
  path.join(
    import.meta.dirname,
    "../src/app/api/openharness/sessions/[sessionId]/route.ts",
  ),
  "utf8",
);
const historyClient = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/components/openharness/history-client.tsx"),
  "utf8",
);
const gardenChat = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/components/openharness/garden-agent-chat.tsx"),
  "utf8",
);
const terminal = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/components/openharness/dashboard-agent-terminal.tsx"),
  "utf8",
);
const runtimeStore = fs.readFileSync(
  path.join(import.meta.dirname, "../src/lib/openharness/runtime-store.ts"),
  "utf8",
);

// The FK clauses below are copied from src/lib/conversations/schema.ts,
// src/lib/db.ts and src/lib/openharness/artifact-schema.ts. The point is the
// ON DELETE behavior, so unrelated columns are omitted.
function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT);
    CREATE TABLE conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL, order_index INTEGER NOT NULL);
    CREATE TABLE conversation_memory_state (
      conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      rolling_summary TEXT NOT NULL DEFAULT '');
    CREATE TABLE openharness_runtime_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      surface TEXT NOT NULL, user_id INTEGER,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      garden_id TEXT);
    CREATE TABLE openharness_runs (
      id TEXT PRIMARY KEY,
      runtime_session_id INTEGER NOT NULL REFERENCES openharness_runtime_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL);
    CREATE TABLE openharness_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      runtime_session_id INTEGER NOT NULL REFERENCES openharness_runtime_sessions(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL);
    CREATE TABLE openharness_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      runtime_session_id INTEGER REFERENCES openharness_runtime_sessions(id) ON DELETE SET NULL);
    CREATE TABLE openharness_artifacts (
      id TEXT PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      runtime_session_id INTEGER NOT NULL REFERENCES openharness_runtime_sessions(id) ON DELETE CASCADE,
      originating_run_id TEXT NOT NULL REFERENCES openharness_runs(id) ON DELETE RESTRICT);
  `);
  db.prepare("INSERT INTO users (username) VALUES ('alice')").run();
  db.prepare("INSERT INTO conversations (public_id, user_id, title) VALUES ('conv_a', 1, 'Chat')").run();
  db.prepare("INSERT INTO conversation_messages (conversation_id, role, order_index) VALUES (1, 'user', 0)").run();
  db.prepare("INSERT INTO conversation_memory_state (conversation_id) VALUES (1)").run();
  db.prepare(
    "INSERT INTO openharness_runtime_sessions (surface, user_id, conversation_id) VALUES ('garden_chat', 1, 1)",
  ).run();
  db.prepare(
    "INSERT INTO openharness_runtime_sessions (surface, user_id, conversation_id) VALUES ('garden_chat', 1, 1)",
  ).run();
  db.prepare("INSERT INTO openharness_messages (runtime_session_id, order_index) VALUES (1, 0)").run();
  db.prepare("INSERT INTO openharness_runs (id, runtime_session_id, status) VALUES ('run_1', 1, 'completed')").run();
  db.prepare("INSERT INTO openharness_audit_events (event_type, runtime_session_id) VALUES ('session.created', 1)").run();
  db.prepare(
    "INSERT INTO openharness_artifacts (id, conversation_id, runtime_session_id, originating_run_id) VALUES ('art_1', 1, 1, 'run_1')",
  ).run();
  return db;
}

const count = (db, table, where = "1=1") =>
  db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get().n;

test("deleting the conversation first clears its transcript, memory and artifacts", () => {
  const db = seed();
  db.transaction(() => {
    db.prepare("DELETE FROM conversations WHERE id = 1").run();
    for (const id of [1, 2]) {
      db.prepare("DELETE FROM openharness_runtime_sessions WHERE id = ?").run(id);
    }
  })();

  assert.equal(count(db, "conversations"), 0);
  assert.equal(count(db, "conversation_messages"), 0);
  assert.equal(count(db, "conversation_memory_state"), 0);
  assert.equal(count(db, "openharness_artifacts"), 0);
  // Every runtime session the conversation owned is gone, not just the newest.
  assert.equal(count(db, "openharness_runtime_sessions"), 0);
  assert.equal(count(db, "openharness_messages"), 0);
  assert.equal(count(db, "openharness_runs"), 0);
  db.close();
});

test("the audit trail outlives the deleted chat", () => {
  const db = seed();
  db.transaction(() => {
    db.prepare("DELETE FROM conversations WHERE id = 1").run();
    for (const id of [1, 2]) {
      db.prepare("DELETE FROM openharness_runtime_sessions WHERE id = ?").run(id);
    }
  })();
  // ON DELETE SET NULL: the record that the session existed survives.
  assert.equal(count(db, "openharness_audit_events"), 1);
  assert.equal(count(db, "openharness_audit_events", "runtime_session_id IS NULL"), 1);
  db.close();
});

test("the artifact ON DELETE RESTRICT run reference cannot strand the delete", () => {
  // openharness_artifacts.originating_run_id is ON DELETE RESTRICT, which would
  // block removing a run that an artifact still points at. It never fires here:
  // artifacts cascade from the runtime session too, so they disappear in the
  // same statement as the run. Both orders must therefore fully succeed.
  for (const order of ["conversation-first", "runtime-first"]) {
    const db = seed();
    const dropConversation = () => db.prepare("DELETE FROM conversations WHERE id = 1").run();
    const dropRuntime = () => {
      for (const id of [1, 2]) {
        db.prepare("DELETE FROM openharness_runtime_sessions WHERE id = ?").run(id);
      }
    };
    db.transaction(() => {
      if (order === "conversation-first") {
        dropConversation();
        dropRuntime();
      } else {
        dropRuntime();
        dropConversation();
      }
    })();
    assert.equal(count(db, "conversations"), 0, order);
    assert.equal(count(db, "openharness_runtime_sessions"), 0, order);
    assert.equal(count(db, "openharness_runs"), 0, order);
    assert.equal(count(db, "openharness_artifacts"), 0, order);
    db.close();
  }
});

test("orphaned runtime sessions are impossible: conversation_id is SET NULL, so rows must be deleted explicitly", () => {
  const db = seed();
  db.prepare("DELETE FROM openharness_artifacts WHERE id = 'art_1'").run();
  db.prepare("DELETE FROM conversations WHERE id = 1").run();
  // Without the route's explicit cleanup this is what would be left behind.
  assert.equal(count(db, "openharness_runtime_sessions", "conversation_id IS NULL"), 2);
  db.close();
});

test("the delete route authorizes, refuses mid-run, and orders its deletes", () => {
  assert.match(routeSource, /export async function DELETE/);
  assert.match(routeSource, /requireUserId/);
  assert.match(routeSource, /requireEnabled/);
  assert.match(routeSource, /getConversationForUser/);
  assert.match(routeSource, /listRuntimeSessionsForConversation/);
  assert.match(routeSource, /getActiveRuntimeRun/);
  assert.match(routeSource, /409,\s*\n?\s*"run_active"/);
  assert.match(routeSource, /db\.transaction/);
  assert.match(routeSource, /conversation\.deleted/);
  assert.ok(
    routeSource.indexOf("deleteConversation(conversation)") <
      routeSource.indexOf("deleteRuntimeSession("),
    "the conversation must be deleted before its runtime sessions",
  );
  assert.match(runtimeStore, /export function listRuntimeSessionsForConversation/);
});

test("both Recents lists delete a chat behind a confirmation", () => {
  assert.match(historyClient, /method: "DELETE"/);
  assert.match(historyClient, /\/api\/openharness\/sessions\/\$\{encodeURIComponent\(sessionId\)\}/);
  for (const [label, source] of [["garden chat", gardenChat], ["terminal", terminal]]) {
    assert.match(source, /deleteChatSession/, label);
    assert.match(source, /window\.confirm\(/, label);
    assert.match(source, /aria-label=\{`Delete chat \$\{item\.title\}`\}/, label);
    assert.match(source, /<TrashIcon/, label);
    // A failed delete must not silently drop the row from the list.
    assert.match(source, /if \(!result\.deleted\) \{[\s\S]*?setHistoryError/, label);
    assert.match(source, /setHistory\(\(current\) => current\.filter/, label);
    // Deleting the chat you are looking at leaves you on a fresh one.
    assert.match(source, /if \(item\.id === session\.sessionId\) startNewChat\(\)/, label);
  }
  // Nested interactive elements are invalid: the open and delete controls are
  // siblings inside the list item.
  assert.doesNotMatch(gardenChat, /<button[^>]*openHistorySession[\s\S]{0,400}?<button/);
});
