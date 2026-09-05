import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import esbuild from "esbuild";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-steering-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const runs = await import("../src/lib/hermes/run-store.ts");
const conversations = await import("../src/lib/conversations/store.ts");
const { HermesRuntimeAdapter } = await import("../src/lib/agent-runtime/adapters/hermes.ts");
const { hermesMessageId } = await import("../src/lib/hermes/message-id.ts");
const state = { db, runs, conversations, calls: [], audit: [], session: null, deliver: async () => true };
globalThis.__steeringTest = state;

const bundle = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../src/app/api/hermes/sessions/[sessionId]/steer/route.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "steering-boundaries", setup(build) {
    const stubs = {
      "next/server": "export const NextResponse = Response;",
      "@/lib/server-auth": "export const requireUserId = async () => 1;",
      "@/lib/hermes/session-service.ts": "export const authorizeRuntimeReference = () => globalThis.__steeringTest.session;",
      "@/lib/agent-runtime/runtime.ts": `export const getAgentRuntimeByKind = () => ({
        steerRun: async input => {
          globalThis.__steeringTest.calls.push(input);
          return globalThis.__steeringTest.deliver(input);
        }
      });`,
      "@/lib/hermes/runtime-store.ts": "export const recordAuditEvent = event => globalThis.__steeringTest.audit.push(event);",
      "@/lib/hermes/run-store.ts": `export const {
        acceptSteerRequest, failSteerRequest, getActiveRuntimeRun,
        getRuntimeRun, getSteerRequest, parseRuntimeRunDispatch, reserveSteerRequest
      } = globalThis.__steeringTest.runs;`,
      "@/lib/conversations/store.ts": `export const {
        appendConversationSteerMessage, ConversationStoreError
      } = globalThis.__steeringTest.conversations;`,
      "@/lib/hermes/route-helpers.ts": `
        export class ApiError extends Error {
          constructor(status, code, message) { super(message); this.status = status; this.code = code; }
        }
        export const requireEnabled = () => {};
        export const readJsonBody = r => r.json();
        export const requireString = v => v;
        export const apiErrorResponse = e => Response.json({ error: e.message, code: e.code }, { status: e.status || 500 });
      `,
    };
    build.onResolve({ filter: /.*/ }, ({ path: specifier }) =>
      Object.hasOwn(stubs, specifier) ? { path: specifier, namespace: "stub" } : undefined);
    build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path: specifier }) => ({ contents: stubs[specifier], loader: "js" }));
  } }],
});
const fixture = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), fixture, fixture.exports);
const { POST } = fixture.exports;

beforeEach(() => {
  db.exec("DELETE FROM hermes_runtime_sessions; DELETE FROM conversations; DELETE FROM users;");
  db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'steer', 'steer@example.test', 'x')").run();
  const chat = conversations.createConversation({ userId: 1, title: "Steering" });
  conversations.reserveConversationTurn({ conversation: chat, clientMessageId: "original-request-01", surface: "dashboard_terminal", content: "Original" });
  const row = db.prepare("INSERT INTO hermes_runtime_sessions (surface, agent_name, workspace_key, conversation_id) VALUES (?, ?, ?, ?)")
    .run("dashboard_terminal", "breadboard-terminal", "steering-test", chat.id);
  state.session = {
    row: { id: Number(row.lastInsertRowid), conversation_id: chat.id, chat_session_id: null, surface: "dashboard_terminal" },
    runtimeKind: "hermes", externalSessionId: "stored", liveSessionId: "live", workspaceKey: "steering-test",
  };
  state.run = runs.beginRuntimeRun({ runtimeSessionId: state.session.row.id, instruction: "Original", dispatch: { clientMessageId: "original-request-01" } });
  state.calls = []; state.audit = []; state.deliver = async () => true;
});
after(() => { delete globalThis.__steeringTest; db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

function request(clientRequestId = "correction-01", text = "Use SQLite") {
  return POST(new Request("http://test/steer", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: state.run.id, clientRequestId, text, assistantContentOffset: 7 }),
  }), { params: Promise.resolve({ sessionId: "stored" }) });
}

test("Hermes desktop steering redirects the active response and requires a positive acknowledgement", async () => {
  const adapter = new HermesRuntimeAdapter({ baseUrl: "http://127.0.0.1:9119", sessionToken: "test", requestTimeoutMs: 5_000 });
  const calls = [];
  let status = "redirected";
  adapter.client = {
    request: async (method, params) => {
      calls.push({ method, params });
      return method === "session.create" ? { session_id: "live", stored_session_id: "stored" } : { status };
    }, clearSession() {},
  };
  const session = await adapter.createSession({ surface: "dashboard_terminal", sessionKey: "steering-test" });
  const input = { ...session, text: "Use SQLite", messageId: "native-turn", clientRequestId: "request-01" };
  assert.equal(await adapter.steerRun(input), true);
  assert.deepEqual(calls.at(-1), { method: "session.redirect", params: { session_id: "live", text: "Use SQLite", queue_if_unavailable: false, expected_turn_id: "native-turn" } });
  status = "rejected";
  assert.equal(await adapter.steerRun(input), false);
  for (status of [undefined, "queued", "streaming"]) await assert.rejects(adapter.steerRun(input), /acknowledge/);
  const before = calls.length;
  assert.equal(await adapter.steerRun({ ...input, attachments: [{ type: "image", name: "image.png", dataUrl: "data:image/png;base64,AA==" }] }), false);
  assert.equal(calls.length, before, "attachments must remain owned by the next prompt");
});

test("completion before acknowledgement retains the original run and correction target", async () => {
  state.deliver = async () => {
    runs.finishRuntimeRun(state.run.id, "completed");
    db.prepare("UPDATE conversation_messages SET status = 'complete' WHERE conversation_id = ?").run(state.session.row.conversation_id);
    return true;
  };
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).runId, state.run.id);
  assert.equal(runs.getActiveRuntimeRun(state.session.row.id), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM hermes_runs").get().count, 1);
  assert.equal(state.calls[0].messageId, hermesMessageId("original-request-01"));
  const rows = conversations.listConversationMessages(state.session.row.conversation_id);
  assert.deepEqual(rows.map(row => row.role), ["user", "user", "assistant"]);
  assert.equal(rows[1].content, "Use SQLite");
  const retry = await request();
  assert.equal((await retry.json()).deduplicated, true);
  assert.equal(state.calls.length, 1);
});

test("concurrent duplicate requests deliver once", async () => {
  let release;
  let entered;
  const delivered = new Promise(resolve => { entered = resolve; });
  state.deliver = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const first = request();
  await delivered;
  const second = await request();
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, "steer_pending");
  release(true);
  assert.equal((await first).status, 200);
  assert.equal(state.calls.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM hermes_messages").get().count, 1);
});

test("a late accepted correction never attaches to a newer pending answer", async () => {
  let successor;
  state.deliver = async () => {
    runs.finishRuntimeRun(state.run.id, "completed");
    const conversationId = state.session.row.conversation_id;
    db.prepare("UPDATE conversation_messages SET status = 'complete' WHERE conversation_id = ?").run(conversationId);
    conversations.reserveConversationTurn({ conversation: conversations.getConversationById(conversationId), clientMessageId: "successor-request-02", surface: "dashboard_terminal", content: "Next question" });
    successor = runs.beginRuntimeRun({ runtimeSessionId: state.session.row.id, instruction: "Next question", dispatch: { clientMessageId: "successor-request-02" } });
    return true;
  };
  assert.equal((await request()).status, 200);
  assert.equal(runs.getActiveRuntimeRun(state.session.row.id).id, successor.id);
  const rows = conversations.listConversationMessages(state.session.row.conversation_id);
  assert.deepEqual(rows.map(row => [row.role, row.client_message_id]), [
    ["user", "original-request-01"], ["user", "steer:correction-01"],
    ["assistant", "original-request-01"], ["user", "successor-request-02"],
    ["assistant", "successor-request-02"],
  ]);
});

test("rejected and completed turns leave follow-up dispatch to the conversation queue", async () => {
  state.deliver = async () => false;
  assert.equal((await (await request()).json()).code, "steer_unavailable");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM hermes_messages").get().count, 0);
  runs.finishRuntimeRun(state.run.id, "completed");
  assert.equal((await (await request("new-correction")).json()).code, "run_not_active");
  assert.equal(state.calls.length, 1);
});

test("an accepted request cannot be reused with different text", async () => {
  assert.equal((await request()).status, 200);
  const conflict = await request("correction-01", "Use Postgres");
  assert.equal((await conflict.json()).code, "client_request_conflict");
  assert.equal(state.calls.length, 1);
});
