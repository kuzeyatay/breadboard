import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, beforeEach } from "node:test";
import Database from "better-sqlite3";
import { build } from "esbuild";
import { issueCapabilityToken } from "../src/lib/hermes/capability-token.ts";

// Exercise the route's real SQL, ranking, capability verification and response
// projection. Only the service/session boundary uses an isolated test fixture.
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE clusters (id INTEGER PRIMARY KEY, slug TEXT);
  CREATE TABLE conversations (
    id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, title TEXT,
    updated_at TEXT, pinned_at TEXT, legacy_chat_session_id INTEGER,
    temporary INTEGER, surface TEXT, default_garden_id INTEGER
  );
  CREATE TABLE conversation_messages (
    conversation_id INTEGER, role TEXT, content TEXT, created_at TEXT,
    status TEXT, order_index INTEGER
  );
`);
const state = globalThis.__chatSearchRouteTest = { db, audit: [] };
const stubs = {
  "@/lib/db.ts": "export default globalThis.__chatSearchRouteTest.db;",
  "@/lib/hermes/tool-service-auth.ts": "export const capabilityForInternalToolRequest = () => globalThis.__chatSearchRouteTest.token;",
  "@/lib/hermes/runtime-store.ts": `const state = globalThis.__chatSearchRouteTest;
    export const getRuntimeSessionById = id => id === state.session.id ? state.session : null;
    export const runtimeExternalSessionId = row => row.hermes_session_id;
    export const getActiveCapabilityDecision = () => state.decision;
    export const recordAuditEvent = event => state.audit.push(event);`,
  "@/lib/conversations/store.ts": `export const getConversationById = id =>
    globalThis.__chatSearchRouteTest.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);`,
  "@/lib/conversations/memory.ts": "export const isSensitiveMemoryText = () => false;",
  "@/lib/hermes/route-helpers.ts": `export class ApiError extends Error {
      constructor(status, code, message) { super(message); this.status = status; this.code = code; }
    }
    export const requireEnabled = () => {};
    export const readJsonBody = request => request.json();
    export const apiErrorResponse = error => Response.json(
      { error: error.message, code: error.code }, { status: error.status || 500 });`,
};
const bundle = await build({
  entryPoints: ["src/app/api/hermes/tools/chat-search/route.ts"],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "chat-search-fixture", setup(builder) {
    builder.onResolve({ filter: /^@\// }, args => stubs[args.path]
      ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
  } }],
});
const routeModule = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), routeModule, routeModule.exports);

function token(overrides = {}) {
  return issueCapabilityToken({
    userId: 7, conversationId: 44, breadboardSessionId: "33",
    hermesSessionId: "runtime", surface: state.session.surface,
    gardenId: state.session.garden_id, activeGardenId: state.session.cluster_id,
    allowedTools: ["chat_search"], ...overrides,
  });
}

function call(args = {}) {
  return routeModule.exports.POST(new Request("http://localhost/api/hermes/tools/chat-search", {
    method: "POST", body: JSON.stringify({ tool: "chat_search", args: { query: "Coulomb integral spherical EM 1 exam", ...args } }),
  }));
}

beforeEach(() => {
  db.exec(`DELETE FROM clusters; DELETE FROM conversations; DELETE FROM conversation_messages;
    INSERT INTO clusters VALUES (3028, 'electromagnetism-1'), (3029, 'telecom-1');`);
  const insert = db.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?, '2026-11-06T10:00:00Z', NULL, ?, ?, ?, ?)");
  for (const [id, publicId, userId, legacyId, temporary, surface, garden] of [
    [44, "conv_current", 7, 1081, 0, "garden_chat", 3028],
    [45, "conv_exam", 7, 1080, 0, "garden_chat", 3028],
    [46, "conv_foreign", 8, 1082, 0, "garden_chat", 3028],
    [47, "conv_other_garden", 7, 1083, 0, "garden_chat", 3029],
    [48, "conv_temporary", 7, 1084, 1, "garden_chat", 3028],
    [49, "conv_terminal", 7, null, 0, "dashboard_terminal", null],
    [50, "conv_unlinked", 7, null, 0, "garden_chat", 3028],
  ]) {
    insert.run(id, publicId, userId, "EM 1 exam: Coulomb integral in spherical coordinates", legacyId, temporary, surface, garden);
    db.prepare("INSERT INTO conversation_messages VALUES (?, 'assistant', ?, '2026-11-06T10:00:00Z', 'complete', 1)")
      .run(id, `Source ${publicId}: with origin (0,0,h), the perpendicular distance is r sin(theta).`);
  }
  state.session = { id: 33, user_id: 7, conversation_id: 44, surface: "garden_chat",
    cluster_id: 3028, garden_id: "electromagnetism-1", hermes_session_id: "runtime" };
  state.decision = { allowedTools: ["chat_search"] };
  state.audit = [];
  state.token = token();
});

after(() => { db.close(); delete globalThis.__chatSearchRouteTest; });

test("Garden search uses its numeric cluster ID and reads the selected exam transcript", async () => {
  const response = await call();
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data.results.map(hit => hit.referenceId), ["conv_exam"]);
  assert.equal(body.data.results[0].id, "1080");
  assert.equal(body.data.uiResources[0].data.gardenSlug, "electromagnetism-1");

  const referenceResponse = await call({ reference_ids: [body.data.results[0].referenceId] });
  const referenceBody = await referenceResponse.json();
  assert.equal(referenceResponse.status, 200, JSON.stringify(referenceBody));
  assert.equal(referenceBody.data.referencesReturned, 1);
  assert.match(referenceBody.data.references[0].messages[0].content, /Source conv_exam:.*r sin\(theta\)/);
  assert.deepEqual(referenceBody.data.uiResources, []);
  assert.equal(state.audit.at(-1).payload.referencesReturned, 1);
});

test("Garden references cannot read another user, another Garden, temporary or excluded chats", async () => {
  for (const referenceId of ["conv_foreign", "conv_other_garden", "conv_temporary", "conv_current", "conv_terminal", "conv_unlinked"]) {
    const response = await call({ reference_ids: [referenceId] });
    assert.equal(response.status, 404, referenceId);
    assert.equal((await response.json()).code, "chat_search_reference_not_found");
  }
});

test("Garden search rejects missing numeric scope and deleted Gardens", async () => {
  state.session.cluster_id = null;
  let response = await call();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "chat_search_garden_scope_missing");
  state.session.cluster_id = 9999;
  response = await call();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "chat_search_garden_missing");
});

test("Terminal search remains available without a Garden and reads its own results", async () => {
  state.session.surface = "dashboard_terminal";
  state.session.cluster_id = null;
  state.session.garden_id = null;
  db.prepare("UPDATE conversations SET surface = 'dashboard_terminal', default_garden_id = NULL WHERE id = 44").run();
  state.token = token();
  const response = await call();
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data.results.map(hit => hit.referenceId), ["conv_terminal"]);
  assert.equal(body.data.uiResources[0].data.surface, "dashboard_terminal");
  assert.equal((await call({ reference_ids: ["conv_terminal"] })).status, 200);
});

test("chat search still rejects invalid capabilities, revoked tools and foreign conversations", async () => {
  for (const invalidToken of [null, token({ conversationId: 45 }), token({ allowedTools: [] }), token({ hermesSessionId: "other-runtime" })]) {
    state.token = invalidToken;
    assert.equal((await call()).status, 403);
  }
  state.token = token();
  state.decision.allowedTools = [];
  assert.equal((await call()).status, 403);
  state.decision.allowedTools = ["chat_search"];
  db.prepare("UPDATE conversations SET user_id = 8 WHERE id = 44").run();
  assert.equal((await call()).status, 403);
  assert.ok(state.audit.every(event => event.eventType === "chatSearch.tool_failed"));
});
