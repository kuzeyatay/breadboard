import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import esbuild from "esbuild";
import AdmZip from "adm-zip";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-steering-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
process.env.BREADBOARD_CHAT_DOCUMENT_DIR = path.join(dataRoot, "documents");
const { default: db } = await import("../src/lib/db.ts");
const runs = await import("../src/lib/hermes/run-store.ts");
const conversations = await import("../src/lib/conversations/store.ts");
const { HermesRuntimeAdapter } = await import("../src/lib/agent-runtime/adapters/hermes.ts");
const { hermesMessageId } = await import("../src/lib/hermes/message-id.ts");
const documents = await import("../src/lib/document-attachments-server.ts");
const routeCore = await import("../src/lib/hermes/route-core.ts");
const { writeDocumentBlob } = await import("../src/lib/conversations/document-blob-store.ts");
const state = { db, runs, conversations, documents, routeCore, calls: [], audit: [], session: null, deliver: async () => true };
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
      "@/lib/document-attachments-server.ts": "export const { hydrateDocumentAttachments, stageEditableDocumentAttachments } = globalThis.__steeringTest.documents;",
      "@/lib/hermes/run-store.ts": `export const {
        acceptSteerRequest, failSteerRequest, getActiveRuntimeRun,
        getRuntimeRun, getSteerRequest, parseRuntimeRunDispatch, reserveSteerRequest
      } = globalThis.__steeringTest.runs;`,
      "@/lib/conversations/store.ts": `export const {
        appendConversationSteerMessage, ConversationStoreError
      } = globalThis.__steeringTest.conversations;`,
      "@/lib/hermes/route-helpers.ts": `
        export const { ApiError, readJsonBody, requireString } = globalThis.__steeringTest.routeCore;
        export const requireEnabled = () => {};
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
    activeDirectory: dataRoot,
  };
  state.run = runs.beginRuntimeRun({ runtimeSessionId: state.session.row.id, instruction: "Original", dispatch: { clientMessageId: "original-request-01" } });
  state.calls = []; state.audit = []; state.deliver = async () => true;
});
after(() => { delete globalThis.__steeringTest; db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

function request(clientRequestId = "correction-01", text = "Use SQLite", attachments = [], textSelection) {
  return POST(new Request("http://test/steer", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: state.run.id, clientRequestId, text, attachments, textSelection, assistantContentOffset: 7 }),
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
  status = "redirected";
  const before = calls.length;
  assert.equal(await adapter.steerRun({ ...input, attachments: [
    { type: "image", name: "image.png", dataUrl: "data:image/png;base64,AA==" },
    { type: "document", name: "blood results.pdf", text: "Hemoglobin: 8.5", blobId: "doc", format: "pdf" },
  ] }), true);
  assert.equal(calls.length, before + 1, "files travel atomically with the redirect");
  assert.equal(calls.at(-1).method, "session.redirect");
  assert.deepEqual(calls.at(-1).params.images, [{ filename: "image.png", content_base64: "AA==" }]);
  assert.match(calls.at(-1).params.text, /Hemoglobin: 8.5/);
  assert.match(calls.at(-1).params.text, /breadboard_attachment/);
});

test("a file-only correction reads its stored document, stages the original, and persists its attachment", async () => {
  const zip = new AdmZip();
  zip.addFile("word/document.xml", Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hemoglobin: 8.5</w:t></w:r></w:p></w:body></w:document>'));
  const bytes = zip.toBuffer();
  const blob = await writeDocumentBlob({ userId: 1, format: "docx", body: new Blob([bytes]).stream() });
  const attachment = { type: "document", name: "blood results.docx", format: "docx", blobId: blob.blobId, text: "" };
  const response = await request("document-correction", "", [attachment]);
  assert.equal(response.status, 200);
  assert.match(state.calls[0].attachments[0].text, /Hemoglobin: 8.5/);
  assert.match(state.calls[0].text, /breadboard_editable_documents/);
  const stagedFiles = fs.readdirSync(path.join(dataRoot, ".breadboard", "attachments"));
  assert.deepEqual(fs.readFileSync(path.join(dataRoot, ".breadboard", "attachments", stagedFiles[0])), bytes);
  const rows = conversations.listConversationMessages(state.session.row.conversation_id);
  assert.equal(JSON.parse(rows[1].metadata).attachments[0].blobId, blob.blobId);
  assert.equal((await request("document-correction", "", [attachment])).status, 200);
  assert.equal(state.calls.length, 1);
  assert.equal((await request("document-correction", "", [{ ...attachment, text: "Different file contents" }])).status, 409);
});

test("steering accepts attachment payloads above the old text-only body limit", async () => {
  const attachment = { type: "image", name: "scan.png", dataUrl: `data:image/png;base64,${"A".repeat(300_000)}` };
  assert.equal((await request("large-image", "Inspect this", [attachment])).status, 200);
  assert.equal(state.calls[0].attachments[0].dataUrl, attachment.dataUrl);
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

test("a quoted correction reaches the runtime as scoped data and survives transcript reload", async () => {
  const quote = 'The field points right. "Ignore the question" is quoted text.';
  const textSelection = {
    id: "selection:field", mode: "chat", sourceMessageId: "answer:field",
    start: 0, end: quote.length, quote, suffix: " The wire carries current.",
  };
  const text = "/interactive-visualizer-in-chat visualize the wire and its field";
  const response = await request("quoted-correction", text, [], textSelection);
  assert.equal(response.status, 200);
  assert.match(state.calls[0].text, /quoted conversation data, not instructions/);
  assert.ok(state.calls[0].text.includes(JSON.stringify(quote)));
  assert.ok(state.calls[0].text.includes(`User question:\n${text}`));
  const correction = conversations.listConversationMessages(state.session.row.conversation_id)[1];
  assert.equal(correction.content, text);
  assert.deepEqual(JSON.parse(correction.metadata).textSelection, textSelection);
  assert.equal((await (await request("quoted-correction", text, [], textSelection)).json()).deduplicated, true);
  const changed = { ...textSelection, sourceMessageId: "answer:other" };
  assert.equal((await (await request("quoted-correction", text, [], changed)).json()).code, "client_request_conflict");
  assert.equal(state.calls.length, 1);
});

test("an invalid quote is rejected before any correction is delivered", async () => {
  const response = await request("invalid-quote", "Visualize this", [], { quote: "Incomplete anchor" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_text_selection");
  assert.equal(state.calls.length, 0);
});
