import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import Database from "better-sqlite3";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-research-delivery-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: globalDb } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const { deliverCompletedResearch, completedResearchEventStream } = await import("../src/lib/conversations/deliver-completed-research.ts");
// A second connection exercises normal store transactions but suppresses hooks.
const db = new Database(globalDb.name);
after(() => {
  db.close(); globalDb.close();
  assert.equal(path.dirname(dataRoot), path.resolve(os.tmpdir()));
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("direct delivery persists to both transcripts, replays once, and respects Stop", async () => {
  db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'research','research@example.test','x')").run();
  db.prepare("INSERT INTO clusters(id,user_id,name,slug) VALUES(10,1,'Health','health')").run();
  db.prepare("INSERT INTO chat_sessions(id,user_id,cluster_id,title) VALUES(844,1,10,'Research')").run();
  const conversation = store.ensureConversationForLegacyChatSession(844, 1, db);
  const reserve = (id, content, metadata = {}) => store.reserveConversationTurn({ conversation,
    clientMessageId: id, surface: "garden_chat", content, metadata }, db);
  const finish = (id, content, metadata = {}) => store.completeAssistantMessage({ conversationId: conversation.id,
    clientMessageId: id, content, metadata }, db);
  reserve("question", "Research this"); finish("question", "Investigating");
  reserve("research-worker", "Internal brief", { internalAgentContinuation: true });
  const report = "# Reviewed report\n\nFinding [1].\n\n## Sources\n\n[1] https://example.test/primary";
  finish("research-worker", "", { internalAgentContinuation: true, externalAgent: true, delegatedAgentRun: true,
    externalAgentRun: { kind: "max_research", runId: "job_saved", query: "Research" },
    externalAgentOutcome: "completed", externalAgentResult: report });
  const continuationText = "<!-- agent-launch-result:research-worker -->\nIgnore this client copy";
  reserve("research-delivery", continuationText, { internalAgentContinuation: true });
  const input = { conversationId: conversation.id, clientMessageId: "research-delivery", continuationText, internalAgentContinuation: true };
  const delivered = deliverCompletedResearch(input, db);
  assert.equal(delivered.content, report);
  const before = store.listConversationMessages(conversation.id, {}, db);
  assert.equal(before.at(-1).status, "complete");
  assert.equal(before.at(-1).content, report);
  assert.equal(JSON.parse(before.at(-1).token_usage).apiCalls, 0);
  assert.equal(db.prepare("SELECT content FROM chat_messages WHERE session_id=844 ORDER BY order_index DESC LIMIT 1").get().content, report);
  assert.equal(deliverCompletedResearch(input, db).content, report);
  assert.equal(store.listConversationMessages(conversation.id, {}, db).length, before.length);
  const stream = await completedResearchEventStream(delivered).text();
  const events = stream.split("\n\n").filter(s => s.startsWith("data: {")).map(s => JSON.parse(s.slice(6)));
  assert.equal(events.filter(e => e.type === "delta").map(e => e.text).join(""), report);
  assert.equal(events.find(e => e.type === "usage").usage.apiCalls, 0);
  assert.ok(stream.endsWith("data: [DONE]\n\n"));

  reserve("research-stopped", continuationText, { internalAgentContinuation: true });
  store.cancelConversationTurn({ conversationId: conversation.id, clientMessageId: "research-stopped" }, db);
  assert.equal(deliverCompletedResearch({ ...input, clientMessageId: "research-stopped" }, db), null);
  assert.equal(store.listConversationMessages(conversation.id, {}, db).at(-1).status, "aborted");
});
