import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatMessagesBelongToConversation } from "../src/lib/conversations/chat-message-ownership.ts";

test("compatibility saves reject another chat's message ids and delegated runs", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE conversations(id INTEGER PRIMARY KEY, user_id INTEGER);
      CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY, conversation_id INTEGER, client_message_id TEXT, metadata TEXT);
      INSERT INTO conversations VALUES (279, 1), (282, 1);
      INSERT INTO conversation_messages VALUES (1, 279, 'headache-turn', NULL),
        (2, 282, 'physique-turn', NULL),
        (3, 282, 'physique-worker', '{"externalAgentRun":{"kind":"max_research","runId":"research-physique"}}'),
        (4, 282, 'gym-worker', '{"toolCalls":{"externalAgentRun":{"kind":"deep_research","runId":"gym-physique"}}}');`);
    const allowed = (messages, id = 279) => chatMessagesBelongToConversation(db, id, 1, messages);
    assert.equal(allowed([{ id: "msg_1", clientMessageId: "headache-turn" }]), true);
    assert.equal(allowed([{ clientMessageId: "new-follow-up" }]), true);
    assert.equal(allowed([{ id: "msg_2" }]), false);
    assert.equal(allowed([{ clientMessageId: "physique-turn" }]), false);
    assert.equal(allowed([{ externalAgentRun: { runId: "research-physique" } }]), false);
    assert.equal(allowed([{ externalAgentRun: { runId: "gym-physique" } }]), false);
    assert.equal(allowed([{ clientMessageId: "physique-worker", externalAgentRun: { runId: "research-physique" } }], 282), true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM conversation_messages").get().n, 4);
  } finally { db.close(); }
});

test("a delegated gym turn keeps its identity and private brief across compatibility backfills", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-chat-owner-"));
  process.env.BREADBOARD_DATA_DIR = root;
  const { default: db } = await import("../src/lib/db.ts");
  const { ensureConversationSchema } = await import("../src/lib/conversations/schema.ts");
  try {
    db.exec(`INSERT INTO users(id,username,email,password_hash) VALUES(1,'test','test@example.test','x');
      INSERT INTO clusters(id,user_id,name,slug) VALUES(1,1,'Health','health');
      INSERT INTO chat_sessions(id,user_id,cluster_id,title) VALUES(832,1,1,'Physique');`);
    const insert = db.prepare("INSERT INTO chat_messages(session_id,role,content,tool_calls,order_index) VALUES(832,?,?,?,?)");
    const metadata = { clientMessageId: "agent-launch-gym-worker", internalAgentContinuation: true, delegatedAgentRun: true,
      externalAgentRun: { kind: "deep_research", runId: "gym-physique", task: "Build a program" }, externalAgentOutcome: "completed" };
    insert.run("user", "Build a program", JSON.stringify(metadata), 0);
    insert.run("assistant", "", JSON.stringify(metadata), 1);
    ensureConversationSchema(db);
    ensureConversationSchema(db);
    const rows = db.prepare("SELECT client_message_id, metadata FROM conversation_messages ORDER BY order_index").all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.client_message_id === metadata.clientMessageId));
    assert.equal(JSON.parse(rows[0].metadata).internalAgentContinuation, true);
    assert.equal(JSON.parse(rows[1].metadata).externalAgentRun.runId, "gym-physique");
    assert.equal(JSON.parse(rows[1].metadata).delegatedAgentRun, true);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
