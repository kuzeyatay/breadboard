import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-orphan-runtime-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const { ensureConversationSchema } = await import("../src/lib/conversations/schema.ts");

after(() => { db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

function bindRuntime(conversationId, title) {
  return Number(db.prepare(`INSERT INTO hermes_runtime_sessions(surface, user_id, hermes_session_id, agent_name, workspace_key, runtime_metadata, conversation_id)
    VALUES ('dashboard_terminal', 1, ?, 'breadboard', 'w', ?, ?)`)
    .run(`s-${Math.random()}`, JSON.stringify({ title }), conversationId).lastInsertRowid);
}

test("a deleted scheduled check chat is not resurrected as an empty chat on restart", () => {
  db.exec("DELETE FROM users; INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'a@example.test', 'x');");
  const check = store.createConversation({ userId: 1, title: "check if my grade is out", temporary: true });
  bindRuntime(check.id, "check if my grade is out");
  store.deleteConversation(check);
  ensureConversationSchema(db);
  const titles = db.prepare("SELECT title FROM conversations WHERE user_id = 1").all().map((row) => row.title);
  assert.deepEqual(titles, []);
});

test("an orphaned legacy runtime that has messages is still migrated", () => {
  const runtimeId = bindRuntime(null, "Legacy chat");
  db.prepare(`INSERT INTO hermes_messages(runtime_session_id, role, content, order_index)
    VALUES (?, 'user', 'hello', 0)`).run(runtimeId);
  ensureConversationSchema(db);
  const row = db.prepare("SELECT conversation_id FROM hermes_runtime_sessions WHERE id = ?").get(runtimeId);
  assert.ok(row.conversation_id > 0);
});
