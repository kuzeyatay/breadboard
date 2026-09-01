import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  ensureHooksSchema,
  pruneHookDeliveries,
} from "../src/lib/hooks/schema.ts";

test("hooks schema initializes idempotently on an existing user database", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1);
  `);

  ensureHooksSchema(db);
  ensureHooksSchema(db);

  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('hooks', 'hook_deliveries') ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, ["hook_deliveries", "hooks"]);

  const hookColumns = db.prepare("PRAGMA table_info(hooks)").all().map((row) => row.name);
  assert.ok(hookColumns.includes("garden_slug"));
  assert.ok(hookColumns.includes("last_fired_at"));
  assert.ok(hookColumns.includes("fire_count"));
});

test("completion delivery keys deduplicate atomically and can be pruned", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1);
  `);
  ensureHooksSchema(db);
  db.prepare(
    `INSERT INTO hooks (
      id, user_id, name, provider, mode, chat_instructions, provider_config
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("completion-hook", 1, "Finished chat", "chat_completed", "chat", "Summarize", "{}");

  const insert = db.prepare(
    "INSERT OR IGNORE INTO hook_deliveries (hook_id, idempotency_key) VALUES (?, ?)",
  );
  assert.equal(insert.run("completion-hook", "chat.completed:42").changes, 1);
  assert.equal(insert.run("completion-hook", "chat.completed:42").changes, 0);

  db.prepare(
    "UPDATE hook_deliveries SET received_at = datetime('now', '-8 days')",
  ).run();
  pruneHookDeliveries(db);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM hook_deliveries").get().count,
    0,
  );
});
