import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, beforeEach } from "node:test";
import Database from "better-sqlite3";
import { build } from "esbuild";
import { issueCapabilityToken } from "../src/lib/hermes/capability-token.ts";
import { ChatCoordinationStore } from "../src/lib/conversations/coordination-store.ts";

const db = new Database(":memory:");
db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
  INSERT INTO users VALUES (1),(2);
  CREATE TABLE conversations(id INTEGER PRIMARY KEY,public_id TEXT,user_id INTEGER,title TEXT,surface TEXT,default_garden_id INTEGER,temporary INTEGER,archived_at TEXT);
  CREATE TABLE conversation_messages(conversation_id INTEGER,client_message_id TEXT,role TEXT,status TEXT,content TEXT);`);
const store = new ChatCoordinationStore(db);
const state = globalThis.__chatCoordinationRoute = { db, store, audit: [], delivered: [] };
const stubs = {
  "@/lib/hermes/tool-service-auth.ts": "export const capabilityForInternalToolRequest = () => globalThis.__chatCoordinationRoute.token;",
  "@/lib/hermes/runtime-store.ts": `const s = globalThis.__chatCoordinationRoute;
    export const getRuntimeSessionById = id => id === 10 ? s.session : null;
    export const runtimeExternalSessionId = row => row.hermes_session_id;
    export const getActiveCapabilityDecision = () => s.decision;
    export const recordAuditEvent = value => s.audit.push(value);`,
  "@/lib/hermes/run-store.ts": `export const getActiveRuntimeRun = () => globalThis.__chatCoordinationRoute.run;
    export const parseRuntimeRunDispatch = run => JSON.parse(run.dispatch_json);`,
  "@/lib/hermes/session-service.ts": "export const listAuthorizedGardens = () => [];",
  "@/lib/conversations/coordination.ts": `const s = globalThis.__chatCoordinationRoute;
    export const coordinationStore = () => s.store;
    export const authorizeCoordinationChat = (user,id) => s.store.chat(user,id);
    export const deliverChatMessages = id => { s.delivered.push(id); return Promise.resolve(); };
    export const waitForChatMessage = input => s.store.receipt(input.userId,input.sourceId,input.messageId);`,
  "@/lib/hermes/route-helpers.ts": `export { ApiError, readJsonBody, requireString } from ${JSON.stringify(new URL("../src/lib/hermes/route-core.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))};
    export const requireEnabled = () => {};
    export const apiErrorResponse = error => Response.json({error:error.message,code:error.code},{status:error.status || 500});`,
};
const bundle = await build({ entryPoints: ["src/app/api/hermes/tools/chat-coordination/route.ts"], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external", plugins: [{ name: "route-fixture", setup(b) {
    b.onResolve({ filter: /^@\// }, args => stubs[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js", resolveDir: process.cwd() }));
  } }] });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const tools = ["chat_list", "chat_send_message", "chat_wait"];
const token = (extra = {}) => issueCapabilityToken({ userId: 1, conversationId: 1, breadboardSessionId: "10",
  hermesSessionId: "runtime-one", surface: "dashboard_terminal", allowedTools: tools, ...extra });
const call = (tool = "chat_list", args = {}) => module.exports.POST(new Request("http://localhost/api/hermes/tools/chat-coordination", {
  method: "POST", body: JSON.stringify({ tool, args }),
}));
beforeEach(() => {
  db.exec(`DELETE FROM chat_agent_messages; DELETE FROM conversations;
    INSERT INTO conversations VALUES (1,'conv_one',1,'One','dashboard_terminal',NULL,0,NULL),
      (2,'conv_two',1,'Two','dashboard_terminal',NULL,0,NULL),(3,'conv_foreign',2,'Foreign','dashboard_terminal',NULL,0,NULL);`);
  state.session = { id: 10, user_id: 1, conversation_id: 1, surface: "dashboard_terminal", hermes_session_id: "runtime-one" };
  state.decision = { allowedTools: tools };
  state.run = { id: "run-one", dispatch_json: JSON.stringify({ clientMessageId: "user-request" }) };
  state.token = token(); state.delivered = []; state.audit = [];
});
after(() => { db.close(); delete globalThis.__chatCoordinationRoute; });

test("route lists owned chats, sends once, and binds polling to the actual sender", async () => {
  const list = await (await call()).json();
  assert.deepEqual(list.data.chats.map(c => c.chatId), ["conv_one", "conv_two"]);
  const args = { chat_id: "conv_two", message: "What is the result?", request_id: "req-one" };
  const sent = await (await call("chat_send_message", args)).json();
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(sent.data.status, "queued");
  const retry = await (await call("chat_send_message", args)).json();
  assert.equal(retry.data.messageId, sent.data.messageId);
  const polled = await (await call("chat_wait", { message_id: sent.data.messageId, timeout_ms: 0 })).json();
  assert.equal(polled.data.status, "queued");
  assert.ok(state.delivered.every(id => id === 2));
  assert.equal((await call("chat_send_message", { ...args, chat_id: "conv_foreign", request_id: "foreign" })).status, 404);
});

test("missing, forged and mismatched tokens cannot read or dispatch other chats", async () => {
  for (const bad of [null, "forged", token({userId:2}), token({conversationId:2}), token({hermesSessionId:"other"}), token({surface:"garden_chat"}), token({allowedTools:[]})]) {
    state.token = bad;
    assert.equal((await call()).status, 403);
  }
  assert.equal(state.delivered.length, 0);
});

test("inactive, revoked and public sessions cannot use coordination", async () => {
  state.run = null; assert.equal((await call()).status, 403);
  state.run = {id:"run-one",dispatch_json:"{}"};
  state.decision = null; assert.equal((await call()).status, 403);
  state.decision = { allowedTools: [] }; assert.equal((await call()).status, 403);
  state.decision = { allowedTools: tools }; state.session.surface = "quartz_ai";
  state.token = token({surface:"quartz_ai"}); assert.equal((await call()).status, 403);
});

test("route bounds payloads and wait duration and does not accept caller identity", async () => {
  for (const args of [{limit:0},{limit:51},{query:2},{after_id:-1}]) assert.equal((await call("chat_list", args)).status, 400);
  assert.equal((await call("chat_wait", {message_id:"msg_unknown",timeout_ms:30001})).status, 400);
  assert.equal((await call("chat_send_message", {chat_id:"conv_two",message:"x".repeat(12001),request_id:"long"})).status, 400);
  assert.equal((await call("chat_send_message", {chat_id:"conv_two",message:"hi"})).status, 400);
  assert.equal((await call("unknown")).status, 400);
  const sent = await (await call("chat_send_message", {chat_id:"conv_two",message:"hi",request_id:"one",source_id:3,user_id:2})).json();
  assert.equal(store.get(sent.data.messageId).source_id, 1);
  assert.equal(store.get(sent.data.messageId).user_id, 1);
});
