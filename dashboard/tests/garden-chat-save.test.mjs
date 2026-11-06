import assert from "node:assert/strict";
import fs from "node:fs";
import test, { after, beforeEach } from "node:test";
import Database from "better-sqlite3";
import ts from "typescript";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE clusters (id INTEGER PRIMARY KEY, user_id INTEGER);
  CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY, cluster_id INTEGER, user_id INTEGER, title TEXT, updated_at TEXT);
  CREATE TABLE conversation_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER, client_message_id TEXT, role TEXT);
  CREATE TABLE conversations (id INTEGER PRIMARY KEY, user_id INTEGER);
  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY, session_id INTEGER, role TEXT, content TEXT, sources TEXT,
    token_usage TEXT, canonical_message_id INTEGER UNIQUE, tool_calls TEXT,
    permission_decisions TEXT, runtime_error TEXT, runtime_status TEXT, order_index INTEGER, created_at TEXT
  );
  INSERT INTO clusters VALUES (1, 1);
  INSERT INTO conversations VALUES (1, 1);
  INSERT INTO chat_sessions VALUES (1, 1, 1, 'Lab report', '2026-10-09');
`);
after(() => db.close());
const completions = [];
const modules = {
  "next-auth/next": { getServerSession: async () => ({ user: { id: "1" } }) },
  "next/server": { NextResponse: { json: Response.json } },
  "@/lib/auth-options": { authOptions: {} },
  "@/lib/db": { default: db },
  "@/lib/conversations/store": {
    ensureConversationForLegacyChatSession: () => ({ id: 1, user_id: 1 }),
    completeAssistantMessage: completion => completions.push(completion),
  },
  "@/lib/conversations/external-agent-cancel": {},
  "@/lib/hermes/session-cancel": {},
  "@/lib/hermes/runtime-store": { listRuntimeSessionsForChatSession: () => [] },
  "@/lib/hermes/run-store": { getActiveRuntimeRun: () => null },
};
for (const name of [
  "chat-token-usage", "chat-attachments", "chat-text-selection", "garden-document-focus",
  "conversations/garden-response-branches", "conversations/chat-message-ownership",
  "conversations/external-agent-runs", "conversations/highlights", "generative-ui/contracts.ts",
]) {
  modules[`@/lib/${name}`] = await import(`../src/lib/${name.replace(/\.ts$/, "")}.ts`);
}
const route = {};
const source = fs.readFileSync(new URL("../src/app/api/chat-sessions/[sessionId]/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("require", "exports", code)(id => {
  assert.ok(id in modules, `Unconfigured route dependency: ${id}`);
  return modules[id];
}, route);

beforeEach(() => {
  db.exec("DELETE FROM chat_messages; DELETE FROM conversation_messages;");
  completions.length = 0;
});
function seed(id, content, role = "user") {
  db.prepare("INSERT INTO conversation_messages VALUES (?, 1, ?, ?)").run(id, `saved-turn-${id}`, role);
  db.prepare(`INSERT INTO chat_messages
    (session_id, role, content, canonical_message_id, tool_calls, order_index, created_at)
    VALUES (1, ?, ?, ?, ?, ?, '2026-10-09T10:00:00Z')`).run(
    role, content, id, JSON.stringify({ marker: id }), id,
  );
}
const save = messages => route.PATCH(new Request("http://localhost/api/chat-sessions/1", {
  method: "PATCH", body: JSON.stringify({ messages }),
}), { params: Promise.resolve({ sessionId: "1" }) });
const rows = () => db.prepare("SELECT role, content, canonical_message_id, tool_calls FROM chat_messages ORDER BY order_index").all();

for (const identifiedFirst of [true, false]) {
  test(`repeated text matches each saved message once (identified first: ${identifiedFirst})`, async () => {
    seed(10, "Attached: pasted-screenshot-1.png");
    seed(11, "Attached: pasted-screenshot-1.png");
    const identified = { id: "msg_10", role: "user", content: "Attached: pasted-screenshot-1.png" };
    const legacy = { role: "user", content: identified.content };
    const messages = identifiedFirst ? [identified, legacy] : [legacy, identified];
    assert.equal((await save(messages)).status, 200);
    const expected = identifiedFirst ? [10, 11] : [11, 10];
    assert.deepEqual(rows().map(row => row.canonical_message_id), expected);
    assert.deepEqual(rows().map(row => JSON.parse(row.tool_calls).marker), expected);
    assert.equal((await save(messages)).status, 200, "retrying the same snapshot stays idempotent");
    assert.deepEqual(rows().map(row => row.canonical_message_id), expected);
  });
}

test("a new turn with the same text cannot inherit another turn's identity or metadata", async () => {
  seed(10, "Please continue");
  assert.equal((await save([
    { clientMessageId: "brand-new-turn", role: "user", content: "Please continue" },
  ])).status, 200);
  assert.equal(rows()[0].canonical_message_id, null);
  assert.equal(JSON.parse(rows()[0].tool_calls).marker, undefined);
});

test("mixed old and identified repeated answers save the new response and its completion", async () => {
  seed(10, "Please continue");
  seed(11, "", "assistant");
  seed(12, "Please continue");
  seed(13, "", "assistant");
  const messages = [
    { id: "msg_10", role: "user", content: "Please continue" },
    { clientMessageId: "saved-turn-11", role: "assistant", content: "" },
    { role: "user", content: "Please continue" },
    { role: "assistant", content: "" },
    { clientMessageId: "latest-question", role: "user", content: "Explain Msg4" },
    { clientMessageId: "latest-answer", role: "assistant", content: "Msg4 resolves contention." },
  ];
  db.prepare("INSERT INTO conversation_messages VALUES (14, 1, 'latest-question', 'user'), (15, 1, 'latest-answer', 'assistant')").run();
  assert.equal((await save(messages)).status, 200);
  assert.deepEqual(rows().map(row => row.canonical_message_id), [10, 11, 12, 13, 14, 15]);
  assert.equal(rows().at(-1).content, "Msg4 resolves contention.");
  assert.deepEqual(completions, [{ conversationId: 1, clientMessageId: "latest-answer", content: "Msg4 resolves contention." }]);
});

const { trimVerificationForTransport } = await import("../src/lib/hermes/evidence.ts");
const fullVerification = {
  state: "verified", unsupportedClaims: [], assumptions: [],
  evidence: [{
    id: "e1", kind: "web_search", title: "search", success: true, timestamp: "2026-10-27T08:00:00Z",
    details: { toolName: "web_search", query: "maxwell", args: { q: "maxwell" }, result: "see https://example.org/maxwell for the derivation" },
  }],
};
function seedAnswer({ canonical, clientMessageId, content }) {
  db.prepare(`INSERT INTO chat_messages
    (session_id, role, content, canonical_message_id, tool_calls, order_index, created_at)
    VALUES (1, 'assistant', ?, ?, ?, 0, '2026-10-27T08:00:00Z')`).run(
    content, canonical, JSON.stringify({ clientMessageId, verification: fullVerification }),
  );
}
const storedVerification = () => JSON.parse(rows()[0].tool_calls).verification;

test("a browser's trimmed verification keeps the evidence panel's links and drops raw payloads", () => {
  const trimmed = trimVerificationForTransport(fullVerification);
  assert.equal(trimmed.detailsTrimmed, true);
  assert.equal("result" in trimmed.evidence[0].details, false);
  assert.equal("args" in trimmed.evidence[0].details, false);
  assert.equal(trimmed.evidence[0].details.query, "maxwell");
  assert.deepEqual(trimmed.evidence[0].websites.map(site => site.url), ["https://example.org/maxwell"]);
  assert.equal(trimVerificationForTransport(trimmed), trimmed, "trimming twice is a no-op");
  assert.equal("result" in fullVerification.evidence[0].details, true, "the original is not mutated");
});

test("saving a trimmed verification back keeps the stored full one", async () => {
  db.prepare("INSERT INTO conversation_messages VALUES (20, 1, 'turn-20', 'assistant')").run();
  seedAnswer({ canonical: 20, clientMessageId: "turn-20", content: "Answer" });
  const trimmed = trimVerificationForTransport(fullVerification);
  assert.equal((await save([{ id: "msg_20", role: "assistant", content: "Answer", verification: trimmed }])).status, 200);
  assert.deepEqual(storedVerification(), fullVerification);
});

test("a trimmed verification finds its original by turn id when no row matches", async () => {
  seedAnswer({ canonical: null, clientMessageId: "turn-7", content: "Old answer" });
  const trimmed = trimVerificationForTransport(fullVerification);
  assert.equal((await save([{ clientMessageId: "turn-7", role: "assistant", content: "Old answer", verification: trimmed }])).status, 200);
  assert.deepEqual(storedVerification(), fullVerification);
});

test("a full verification from a live turn still replaces the stored one", async () => {
  db.prepare("INSERT INTO conversation_messages VALUES (21, 1, 'turn-21', 'assistant')").run();
  seedAnswer({ canonical: 21, clientMessageId: "turn-21", content: "Answer" });
  const fresh = { ...fullVerification, state: "partially_verified" };
  assert.equal((await save([{ id: "msg_21", role: "assistant", content: "Answer", verification: fresh }])).status, 200);
  assert.equal(storedVerification().state, "partially_verified");
});

test("a retry's branch copy of trimmed answers is stored with their full evidence", async () => {
  db.prepare("INSERT INTO conversation_messages VALUES (30, 1, 'turn-30', 'assistant')").run();
  seedAnswer({ canonical: 30, clientMessageId: "turn-30", content: "First attempt" });
  const trimmed = trimVerificationForTransport(fullVerification);
  const question = { clientMessageId: "q-1", role: "user", content: "Derive it" };
  const branchGroups = { "q-1": { id: "q-1", activeIndex: 1, variants: [
    [question, { id: "msg_30", clientMessageId: "turn-30", role: "assistant", content: "First attempt", verification: trimmed }],
    [question, { clientMessageId: "turn-31", role: "assistant", content: "Second attempt", verification: { ...fullVerification, state: "unverified" } }],
  ] } };
  const response = await route.PATCH(new Request("http://localhost/api/chat-sessions/1", {
    method: "PATCH", body: JSON.stringify({ messages: [question, branchGroups["q-1"].variants[1][1]], branchGroups }),
  }), { params: Promise.resolve({ sessionId: "1" }) });
  assert.equal(response.status, 200);
  const stored = JSON.parse(db.prepare("SELECT value FROM garden_response_branches WHERE session_id = 1 AND group_id = 'q-1'").get().value);
  assert.deepEqual(stored.variants[0][1].verification, fullVerification, "the trimmed earlier answer keeps its stored evidence");
  assert.equal(stored.variants[1][1].verification.state, "unverified", "the new attempt's own evidence is saved as sent");
});
