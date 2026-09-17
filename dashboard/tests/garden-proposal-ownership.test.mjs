import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { build } from "esbuild";
import ts from "typescript";
import { ensureProposalOwnershipSchema, proposalAssistantMessageId } from "../src/lib/hermes/proposal-ownership.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE conversations (id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER);
    CREATE TABLE clusters (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE conversation_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER, client_message_id TEXT, role TEXT);
    CREATE TABLE hermes_runtime_sessions (id INTEGER PRIMARY KEY, conversation_id INTEGER, user_id INTEGER);
    CREATE TABLE hermes_runs (id TEXT PRIMARY KEY, runtime_session_id INTEGER, status TEXT, dispatch_json TEXT, started_at TEXT, finished_at TEXT);
    CREATE TABLE hermes_proposals (id INTEGER PRIMARY KEY, cluster_id INTEGER, garden_id TEXT, surface TEXT,
      kind TEXT, page_slug TEXT, rationale TEXT, payload TEXT, evidence_anchors TEXT,
      status TEXT DEFAULT 'pending', created_by_user_id INTEGER, runtime_session_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')), decided_at TEXT);
    INSERT INTO conversations VALUES (1, 'conv-current', 10), (2, 'conv-other', 20);
    INSERT INTO clusters VALUES (1, 'EM 1');
    INSERT INTO hermes_runtime_sessions VALUES (5, 1, 10), (6, 2, 20);
    INSERT INTO conversation_messages VALUES (101,1,'turn-2','assistant'), (102,1,'turn-3','assistant'),
      (103,1,'later','assistant'), (104,1,'turn-2','user'), (201,2,'turn-2','assistant');
    INSERT INTO hermes_runs VALUES
      ('run-2',5,'complete','{"clientMessageId":"turn-2"}','2026-09-08T09:47:22.556Z','2026-09-08T09:52:45.367Z'),
      ('run-3',5,'complete','{"clientMessageId":"turn-3"}','2026-09-08T10:12:21.261Z','2026-09-08T10:16:50.314Z'),
      ('later-run',5,'active','{"clientMessageId":"later"}','2026-09-08T10:21:18.002Z',NULL);
    INSERT INTO hermes_proposals (id,cluster_id,garden_id,surface,kind,payload,created_by_user_id,runtime_session_id,created_at)
      VALUES (2,1,'em-1','garden_chat','page_revision','{}',10,5,'2026-09-08 09:52:30'),
             (3,1,'em-1','garden_chat','page_revision','{}',10,5,'2026-09-08 10:16:27');
  `);
  return db;
}

test("old revisions recover their creating turns, remain stable on restart, and never bind to a later mention", () => {
  const db = fixture();
  try {
    ensureProposalOwnershipSchema(db);
    ensureProposalOwnershipSchema(db);
    const owners = () => db.prepare("SELECT id, assistant_message_id FROM hermes_proposals ORDER BY id").all().map(row => ({ ...row }));
    assert.deepEqual(owners(), [{ id: 2, assistant_message_id: 101 }, { id: 3, assistant_message_id: 102 }]);
    db.exec("DELETE FROM conversation_messages WHERE id = 101");
    ensureProposalOwnershipSchema(db);
    assert.equal(owners()[0].assistant_message_id, null);
    assert.equal(db.prepare("SELECT status FROM hermes_proposals WHERE id=2").get().status, "pending");
  } finally { db.close(); }
});

test("legacy recovery refuses ambiguous, malformed, unmatched and cross-user run ownership", () => {
  const db = fixture();
  try {
    db.exec(`
      INSERT INTO hermes_runs VALUES ('overlap',5,'complete','{"clientMessageId":"later"}','2026-09-08T09:50:00Z','2026-09-08T09:55:00Z');
      INSERT INTO hermes_proposals (id,payload,created_by_user_id,runtime_session_id,created_at) VALUES
        (4,'{}',20,5,'2026-09-08 10:16:27'),
        (5,'{}',10,5,'2026-09-08 09:00:00'),
        (6,'{}',10,5,'2026-09-08 10:19:00');
      INSERT INTO hermes_runs VALUES ('invalid',5,'complete','not json','2026-09-08T10:18:00Z','2026-09-08T10:20:00Z');
    `);
    ensureProposalOwnershipSchema(db);
    for (const id of [2,4,5,6]) assert.equal(db.prepare("SELECT assistant_message_id FROM hermes_proposals WHERE id=?").get(id).assistant_message_id, null);
    assert.equal(db.prepare("SELECT assistant_message_id FROM hermes_proposals WHERE id=3").get().assistant_message_id, 102);
    assert.equal(proposalAssistantMessageId(db, 5, 10), 103);
    assert.equal(proposalAssistantMessageId(db, 5, 20), null);
  } finally { db.close(); }
});

test("new proposals persist the current server-owned assistant and the authenticated listing returns that owner", async () => {
  const db = fixture();
  globalThis.__proposalOwnershipDb = db;
  try {
    ensureProposalOwnershipSchema(db);
    const bundle = await build({
      entryPoints: [new URL("../src/lib/hermes/runtime-store.ts", import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, "")],
      bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
      plugins: [{ name: "database-fixture", setup(builder) {
        builder.onResolve({ filter: /\/db\.ts$/ }, () => ({ path: "db", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export default globalThis.__proposalOwnershipDb" }));
      } }],
    });
    const loaded = { exports: {} };
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
    const { createProposal, listPendingProposalsForConversation } = loaded.exports;
    const row = createProposal({ clusterId: 1, gardenId: "em-1", surface: "garden_chat", kind: "page_revision",
      payload: { patchOrReplacement: "New introduction" }, runtimeSessionId: 5, createdByUserId: 10,
      assistantMessageId: 201 }); // A supplied owner must not override the server's run.
    assert.equal(row.assistant_message_id, 103);
    db.exec("UPDATE hermes_runs SET status='complete', finished_at=datetime('now') WHERE id='later-run'");
    assert.equal(listPendingProposalsForConversation({ userId: 10, conversationPublicId: "conv-current" }).find(p => p.id === row.id).assistant_message_id, 103);
    assert.deepEqual(listPendingProposalsForConversation({ userId: 20, conversationPublicId: "conv-current" }), []);

    const route = fs.readFileSync(new URL("../src/app/api/hermes/proposals/route.ts", import.meta.url), "utf8");
    const tree = ts.createSourceFile("route.ts", route, ts.ScriptTarget.Latest, true);
    const handler = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "GET");
    const js = ts.transpileModule(handler.getText(tree).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const deps = { requireUserId: async () => 10, getConversationForUser: () => {}, authorizeGardenAccess: () => ({ isOwner: true }),
      listPendingProposalsForConversation, NextResponse: { json: value => Response.json(value) }, apiErrorResponse: error => { throw error; } };
    const get = new Function(...Object.keys(deps), `${js};return GET`)(...Object.values(deps));
    const response = await get(new Request("http://localhost/api/hermes/proposals?conversationId=conv-current"));
    const data = await response.json();
    assert.equal(data.proposals.find(p => p.id === 2).assistantMessageId, "msg_101");
    assert.equal(data.proposals.find(p => p.id === row.id).assistantMessageId, "msg_103");
  } finally { delete globalThis.__proposalOwnershipDb; db.close(); }
});
