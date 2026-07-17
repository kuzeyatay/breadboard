import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// Verify the OpenHarness migration is additive and backward compatible: an old
// database (pre-integration schema) still opens, existing rows remain readable,
// and the new columns/tables are present and nullable after migration.
//
// We reproduce the migration's `ensureColumn` + CREATE TABLE IF NOT EXISTS steps
// against a throwaway in-memory DB seeded with the OLD schema, mirroring
// dashboard/src/lib/db.ts, so the test does not touch the real brain.db.

function seedOldSchema(db) {
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email TEXT, password_hash TEXT);
    CREATE TABLE clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, slug TEXT UNIQUE, visibility TEXT DEFAULT 'private', chat_accessible INTEGER DEFAULT 0);
    CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, cluster_id INTEGER, user_id INTEGER, title TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, role TEXT, content TEXT, sources TEXT, token_usage TEXT, order_index INTEGER, created_at TEXT DEFAULT (datetime('now')));
  `);
  db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)").run("alice", "a@x.com", "h");
  db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, ?, ?)").run(1, "Physics", "physics");
  db.prepare("INSERT INTO chat_sessions (cluster_id, user_id, title) VALUES (?, ?, ?)").run(1, 1, "Old chat");
  db.prepare("INSERT INTO chat_messages (session_id, role, content, order_index) VALUES (?, ?, ?, ?)").run(1, "user", "hi", 0);
}

function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function applyMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS openharness_runtime_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, surface TEXT NOT NULL, user_id INTEGER,
      chat_session_id INTEGER, openharness_session_id TEXT, agent_name TEXT NOT NULL,
      cluster_id INTEGER, garden_id TEXT, page_slug TEXT, workspace_key TEXT NOT NULL,
      runtime_metadata TEXT, last_runtime_status TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS openharness_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, runtime_session_id INTEGER NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, sources TEXT, token_usage TEXT, tool_calls TEXT, permission_decisions TEXT,
      runtime_error TEXT, runtime_status TEXT, proposal TEXT, order_index INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS openharness_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cluster_id INTEGER, garden_id TEXT NOT NULL, surface TEXT NOT NULL,
      kind TEXT NOT NULL, page_slug TEXT, rationale TEXT, payload TEXT NOT NULL, evidence_anchors TEXT,
      status TEXT DEFAULT 'pending', created_by_user_id INTEGER, runtime_session_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')), decided_at TEXT);
  `);
  ensureColumn(db, "chat_messages", "tool_calls", "tool_calls TEXT");
  ensureColumn(db, "chat_messages", "permission_decisions", "permission_decisions TEXT");
  ensureColumn(db, "chat_messages", "runtime_error", "runtime_error TEXT");
  ensureColumn(db, "chat_messages", "runtime_status", "runtime_status TEXT");
  ensureColumn(db, "chat_messages", "proposal", "proposal TEXT");
}

test("migration is additive and existing data survives", () => {
  const db = new Database(":memory:");
  seedOldSchema(db);
  applyMigration(db);

  // Existing rows still readable.
  const message = db.prepare("SELECT role, content FROM chat_messages WHERE session_id = 1").get();
  assert.equal(message.content, "hi");

  // New nullable columns present.
  const cols = db.prepare("PRAGMA table_info(chat_messages)").all().map((c) => c.name);
  for (const col of ["tool_calls", "permission_decisions", "runtime_error", "runtime_status", "proposal"]) {
    assert.ok(cols.includes(col), `chat_messages should have ${col}`);
  }

  // New tables usable.
  const rt = db.prepare(
    "INSERT INTO openharness_runtime_sessions (surface, agent_name, workspace_key) VALUES (?, ?, ?)",
  ).run("dashboard_terminal", "breadboard-terminal", "terminal/abc");
  assert.ok(rt.lastInsertRowid > 0);

  db.prepare(
    "INSERT INTO openharness_messages (runtime_session_id, role, content, order_index) VALUES (?, ?, ?, ?)",
  ).run(rt.lastInsertRowid, "assistant", "hello", 0);
  const rtMsg = db.prepare("SELECT content FROM openharness_messages WHERE runtime_session_id = ?").get(rt.lastInsertRowid);
  assert.equal(rtMsg.content, "hello");

  db.close();
});

test("re-applying the migration is idempotent", () => {
  const db = new Database(":memory:");
  seedOldSchema(db);
  applyMigration(db);
  applyMigration(db); // second run must not throw
  const cols = db.prepare("PRAGMA table_info(chat_messages)").all().map((c) => c.name);
  assert.equal(cols.filter((c) => c === "proposal").length, 1);
  db.close();
});

test("migration on an empty database creates all runtime tables", () => {
  const db = new Database(":memory:");
  // A minimal base schema (users/clusters/chat_sessions/chat_messages) then the
  // runtime migration — mirrors a fresh install where db.ts creates everything.
  seedOldSchemaEmpty(db);
  applyMigration(db);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'openharness%'")
    .all()
    .map((t) => t.name)
    .sort();
  assert.deepEqual(tables, [
    "openharness_messages",
    "openharness_proposals",
    "openharness_runtime_sessions",
  ]);
  db.close();
});

function seedOldSchemaEmpty(db) {
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email TEXT, password_hash TEXT);
    CREATE TABLE clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, slug TEXT UNIQUE);
    CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, cluster_id INTEGER, user_id INTEGER, title TEXT);
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, role TEXT, content TEXT, order_index INTEGER);
  `);
}
