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
    "../src/app/api/hermes/sessions/[sessionId]/route.ts",
  ),
  "utf8",
);
const historyClient = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/components/hermes/history-client.tsx"),
  "utf8",
);
const gardenChat = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/components/hermes/garden-agent-chat.tsx"),
  "utf8",
);
const terminal = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/components/hermes/dashboard-agent-terminal.tsx"),
  "utf8",
);
const terminalSidebar = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/components/hermes/terminal-sidebar.tsx"),
  "utf8",
);
const runtimeStore = fs.readFileSync(
  path.join(import.meta.dirname, "../src/lib/hermes/runtime-store.ts"),
  "utf8",
);

// The FK clauses below are copied from src/lib/conversations/schema.ts,
// src/lib/db.ts and src/lib/hermes/artifact-schema.ts. The point is the
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
    CREATE TABLE hermes_runtime_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      surface TEXT NOT NULL, user_id INTEGER,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      garden_id TEXT);
    CREATE TABLE hermes_runs (
      id TEXT PRIMARY KEY,
      runtime_session_id INTEGER NOT NULL REFERENCES hermes_runtime_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL);
    CREATE TABLE hermes_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      runtime_session_id INTEGER NOT NULL REFERENCES hermes_runtime_sessions(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL);
    CREATE TABLE hermes_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      runtime_session_id INTEGER REFERENCES hermes_runtime_sessions(id) ON DELETE SET NULL);
    CREATE TABLE hermes_artifacts (
      id TEXT PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      runtime_session_id INTEGER NOT NULL REFERENCES hermes_runtime_sessions(id) ON DELETE CASCADE,
      originating_run_id TEXT NOT NULL REFERENCES hermes_runs(id) ON DELETE RESTRICT);
  `);
  db.prepare("INSERT INTO users (username) VALUES ('alice')").run();
  db.prepare("INSERT INTO conversations (public_id, user_id, title) VALUES ('conv_a', 1, 'Chat')").run();
  db.prepare("INSERT INTO conversation_messages (conversation_id, role, order_index) VALUES (1, 'user', 0)").run();
  db.prepare("INSERT INTO conversation_memory_state (conversation_id) VALUES (1)").run();
  db.prepare(
    "INSERT INTO hermes_runtime_sessions (surface, user_id, conversation_id) VALUES ('garden_chat', 1, 1)",
  ).run();
  db.prepare(
    "INSERT INTO hermes_runtime_sessions (surface, user_id, conversation_id) VALUES ('garden_chat', 1, 1)",
  ).run();
  db.prepare("INSERT INTO hermes_messages (runtime_session_id, order_index) VALUES (1, 0)").run();
  db.prepare("INSERT INTO hermes_runs (id, runtime_session_id, status) VALUES ('run_1', 1, 'completed')").run();
  db.prepare("INSERT INTO hermes_audit_events (event_type, runtime_session_id) VALUES ('session.created', 1)").run();
  db.prepare(
    "INSERT INTO hermes_artifacts (id, conversation_id, runtime_session_id, originating_run_id) VALUES ('art_1', 1, 1, 'run_1')",
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
      db.prepare("DELETE FROM hermes_runtime_sessions WHERE id = ?").run(id);
    }
  })();

  assert.equal(count(db, "conversations"), 0);
  assert.equal(count(db, "conversation_messages"), 0);
  assert.equal(count(db, "conversation_memory_state"), 0);
  assert.equal(count(db, "hermes_artifacts"), 0);
  // Every runtime session the conversation owned is gone, not just the newest.
  assert.equal(count(db, "hermes_runtime_sessions"), 0);
  assert.equal(count(db, "hermes_messages"), 0);
  assert.equal(count(db, "hermes_runs"), 0);
  db.close();
});

test("the audit trail outlives the deleted chat", () => {
  const db = seed();
  db.transaction(() => {
    db.prepare("DELETE FROM conversations WHERE id = 1").run();
    for (const id of [1, 2]) {
      db.prepare("DELETE FROM hermes_runtime_sessions WHERE id = ?").run(id);
    }
  })();
  // ON DELETE SET NULL: the record that the session existed survives.
  assert.equal(count(db, "hermes_audit_events"), 1);
  assert.equal(count(db, "hermes_audit_events", "runtime_session_id IS NULL"), 1);
  db.close();
});

test("the artifact ON DELETE RESTRICT run reference cannot strand the delete", () => {
  // hermes_artifacts.originating_run_id is ON DELETE RESTRICT, which would
  // block removing a run that an artifact still points at. It never fires here:
  // artifacts cascade from the runtime session too, so they disappear in the
  // same statement as the run. Both orders must therefore fully succeed.
  for (const order of ["conversation-first", "runtime-first"]) {
    const db = seed();
    const dropConversation = () => db.prepare("DELETE FROM conversations WHERE id = 1").run();
    const dropRuntime = () => {
      for (const id of [1, 2]) {
        db.prepare("DELETE FROM hermes_runtime_sessions WHERE id = ?").run(id);
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
    assert.equal(count(db, "hermes_runtime_sessions"), 0, order);
    assert.equal(count(db, "hermes_runs"), 0, order);
    assert.equal(count(db, "hermes_artifacts"), 0, order);
    db.close();
  }
});

test("orphaned runtime sessions are impossible: conversation_id is SET NULL, so rows must be deleted explicitly", () => {
  const db = seed();
  db.prepare("DELETE FROM hermes_artifacts WHERE id = 'art_1'").run();
  db.prepare("DELETE FROM conversations WHERE id = 1").run();
  // Without the route's explicit cleanup this is what would be left behind.
  assert.equal(count(db, "hermes_runtime_sessions", "conversation_id IS NULL"), 2);
  db.close();
});

test("the delete route authorizes, stops the chat's live work, and orders its deletes", () => {
  assert.match(routeSource, /export async function DELETE/);
  assert.match(routeSource, /requireUserId/);
  assert.match(routeSource, /requireEnabled/);
  assert.match(routeSource, /getConversationForUser/);
  assert.match(routeSource, /listRuntimeSessionsForConversation/);
  // Deleting cancels rather than refusing: once the rows that name a run are
  // gone, nothing can ever reach it again.
  assert.doesNotMatch(routeSource, /"run_active"/);
  assert.match(routeSource, /cancelRunningExternalAgentRuns\(userId, conversation\.id\)/);
  assert.match(routeSource, /cancelRuntimeSessionWork\(userId, runtimeSession\)/);
  // Agent runs are read out of the transcript, so they have to be stopped
  // before the cascade takes the messages that hold their run ids.
  assert.ok(
    routeSource.indexOf("cancelRunningExternalAgentRuns") <
      routeSource.indexOf("db.transaction"),
    "agent runs must be cancelled before the rows are deleted",
  );
  assert.ok(
    routeSource.indexOf("cancelRuntimeSessionWork") < routeSource.indexOf("db.transaction"),
    "runtime work must be cancelled before the rows are deleted",
  );
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
  assert.match(historyClient, /\/api\/hermes\/sessions\/\$\{encodeURIComponent\(sessionId\)\}/);
  for (const [label, source] of [["garden chat", gardenChat], ["terminal", terminal]]) {
    assert.match(source, /deleteChatSession/, label);
    // Asked in the app's own sheet, not the shell's dialog.
    assert.match(source, /await confirm\(\{/, label);
    assert.doesNotMatch(source, /window\.confirm\(/, label);
    // A failed delete must not silently drop the row from the list.
    assert.match(source, /if \(!result\.deleted\) \{[\s\S]*?setHistoryError/, label);
    // The confirmation says what the delete now does to work still in flight.
    assert.match(source, /Anything it is still running is stopped/, label);
    assert.match(source, /setHistory\(\(current\) => current\.filter/, label);
    // Deleting the chat you are looking at leaves you on a fresh one.
    assert.match(source, /if \(item\.id === session\.sessionId\) startNewChat\(\)/, label);
  }

  // Garden chat keeps the always-visible trash control on the row.
  assert.match(gardenChat, /aria-label=\{`Delete chat \$\{item\.title\}`\}/);
  assert.match(gardenChat, /<TrashIcon/);

  // The terminal moved the per-chat actions into the rail's row menu, so the
  // confirmation still lives with the delete call while the control that
  // reaches it is one hover-revealed menu item.
  assert.match(terminal, /onDeleteChat=\{\(chat\) => void deleteHistorySession\(chat\)\}/);
  assert.match(terminalSidebar, /aria-label=\{`More actions for \$\{chat\.title\}`\}/);
  assert.match(terminalSidebar, /role="menuitem"[\s\S]{0,200}onClick=\{onDelete\}/);
  // A chat that is mid-run is deletable now that the route stops the run for
  // you, so nothing in the rail may gate the control that reaches it.
  assert.doesNotMatch(terminalSidebar, /busy/);
  // Nested interactive elements are invalid: the open and delete controls are
  // siblings inside the list item.
  assert.doesNotMatch(gardenChat, /<button[^>]*openHistorySession[\s\S]{0,400}?<button/);
});

test("the terminal deletes a batch of chats behind one confirmation, and reports what survived", () => {
  assert.match(terminal, /async function deleteHistorySessions\(items: TerminalSidebarChat\[\]\)/);
  assert.match(terminal, /onDeleteChats=\{\(selected\) => void deleteHistorySessions\(selected\)\}/);
  assert.match(terminal, /if \(items\.length === 0\) return;/);
  // One confirmation for the batch, naming what is about to go.
  assert.match(terminal, /const single = items\.length === 1;/);
  assert.match(terminal, /title: single \? "Delete this chat\?" : `Delete \$\{items\.length\} chats\?`/);
  assert.match(terminal, /subject: single \? `“\$\{items\[0\]\.title\}”` : null/);
  assert.doesNotMatch(terminal, /window\.confirm\(\s*`Delete /);

  // A delete can still fail for other reasons, so a partial result is normal:
  // only the chats that actually went leave the list, and the rest are counted
  // back to the user instead of disappearing quietly.
  assert.match(terminal, /for \(const item of items\) \{[\s\S]{0,220}await deleteChatSession\(item\.id\)/);
  assert.match(terminal, /current\.filter\(\(entry\) => !deleted\.has\(entry\.id\)\)/);
  assert.match(terminal, /\$\{failed\} of \$\{items\.length\} chats could not be deleted\./);
  // Deleting the chat you are looking at still leaves you on a fresh one.
  assert.match(terminal, /if \(session\.sessionId && deleted\.has\(session\.sessionId\)\) startNewChat\(\)/);
});
