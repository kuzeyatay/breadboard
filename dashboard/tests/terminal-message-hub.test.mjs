import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import ts from "typescript";
import crypto from "node:crypto";
import * as clicky from "../src/lib/clicky/companion.ts";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-terminal-hub-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const presentation = await import("../src/lib/hermes/session-presentation.ts");
const surfacePolicy = await import("../src/lib/hermes/session-surface.ts");
const runtime = await import("../src/lib/hermes/runtime-store.ts");
const config = await import("../src/lib/hermes/config.ts");
const origins = await import("../src/lib/conversations/origin-label.ts");
const search = await import("../src/lib/conversations/search.ts");
const core = await import("../src/lib/hermes/route-core.ts");
const client = await import("../src/lib/hermes/session-client.ts");
const notificationStore = await import("../src/lib/chat-notifications/store.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec("DELETE FROM hermes_runtime_sessions; DELETE FROM conversations; DELETE FROM clusters; DELETE FROM users;");
  db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x'), (2, 'bob', 'bob@example.test', 'x')").run();
  db.prepare("INSERT INTO clusters(id, user_id, name, slug) VALUES (10, 1, 'EM 1', 'em-1'), (20, 1, 'EM 2', 'em-2')").run();
});

// Execute the real route bodies against the isolated database. Only the HTTP
// framework, authentication and external runtime dispatch are replaced.
function route(relative, overrides = {}) {
  const modules = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/server-auth": {
      requireUserId: async () => 1,
      RouteError: class extends Error { constructor(status, message) { super(message); this.status = status; } },
      routeErrorResponse: (error) => Response.json({ error: error.message }, { status: error.status ?? 500 }),
    },
    "@/lib/db": { default: db },
    "@/lib/conversations/store.ts": store,
    "@/lib/conversations/origin-label.ts": origins,
    "@/lib/conversations/search.ts": search,
    "@/lib/chat-notifications/store": notificationStore,
    "@/lib/hermes/config.ts": config,
    "@/lib/hermes/session-presentation.ts": presentation,
    "@/lib/hermes/session-surface.ts": surfacePolicy,
    "@/lib/hermes/route-helpers.ts": {
      ...core,
      requireEnabled() {},
      apiErrorResponse(error) { return Response.json({ error: error.message }, { status: error.status ?? 500 }); },
    },
    "@/lib/max-research/conversation-persistence.ts": { reconcileMaxResearchConversation: async () => {} },
    ...overrides,
  };
  const source = fs.readFileSync(new URL(`../src/app/api/hermes/sessions/${relative}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((id) => modules[id] ?? {}, exports);
  return exports;
}

function gardenChat(historySurface = "garden_chat", clusterId = 10) {
  const legacy = db.prepare("INSERT INTO chat_sessions(cluster_id, user_id, title, history_surface) VALUES (?, 1, 'Circuit question', ?)").run(clusterId, historySurface);
  return store.ensureConversationForLegacyChatSession(Number(legacy.lastInsertRowid), 1);
}

function finish(chat, id, question = "Explain resonance", answer = "Resonance explained") {
  const clientMessageId = `hub-test-${id}`;
  store.reserveConversationTurn({ conversation: chat, clientMessageId, surface: chat.surface, content: question });
  store.completeAssistantMessage({ conversationId: chat.id, clientMessageId, content: answer });
}

test("terminal history includes every saved surface with source labels before a runtime exists", async () => {
  const terminal = store.createConversation({ userId: 1, title: "General chat" });
  const workspace = gardenChat();
  const assistant = gardenChat("assistant", 20);
  const page = store.createConversation({ userId: 1, title: "Page question", surface: "quartz_ai", defaultGardenId: 10, scopeKind: "page" });
  store.createConversation({ userId: 2, title: "Someone else's chat" });
  store.createConversation({ userId: 1, temporary: true, title: "Temporary chat" });
  for (const chat of [terminal, workspace, assistant, page]) finish(chat, `turn-${chat.id}`);
  const api = route("route.ts");
  const response = await api.GET(new Request("http://localhost/api/hermes/sessions?surface=dashboard_terminal"));
  assert.equal(response.status, 200);
  const { sessions } = await response.json();
  assert.equal(sessions.length, 4);
  assert.deepEqual(new Set(sessions.map((chat) => chat.originLabel)), new Set(["Terminal", "EM 1: Workspace", "EM 2: Assistant", "EM 1: Page AI"]));
  assert.ok(sessions.every((chat) => chat.messageCount === 2 && !Object.hasOwn(chat, "messages")));
  assert.equal(sessions.find((chat) => chat.id === page.public_id).surface, "quartz_ai");
  const scoped = await (await api.GET(new Request("http://localhost/api/hermes/sessions?surface=garden_chat"))).json();
  assert.equal(scoped.sessions.length, 2);
});

test("terminal opens another surface's exact transcript while enforcing ownership", async () => {
  const chat = gardenChat();
  finish(chat, "workspace-first");
  const api = route("[sessionId]/route.ts");
  const params = { params: Promise.resolve({ sessionId: chat.public_id }) };
  const response = await api.GET(new Request("http://localhost/chat?surface=dashboard_terminal"), params);
  assert.equal(response.status, 200);
  const { session } = await response.json();
  assert.deepEqual(session.messages.map((message) => message.content), ["Explain resonance", "Resonance explained"]);
  assert.equal(session.surface, "garden_chat");
  assert.equal((await api.GET(new Request("http://localhost/chat?surface=quartz_ai"), params)).status, 404);
  const other = store.createConversation({ userId: 2 });
  assert.equal((await api.GET(new Request("http://localhost/chat?surface=dashboard_terminal"), { params: Promise.resolve({ sessionId: other.public_id }) })).status, 404);
});

test("hub search finds message contents and source names while garden search stays local", async () => {
  const workspace = gardenChat();
  const assistant = gardenChat("assistant", 20);
  finish(workspace, "first");
  finish(assistant, "second");
  const api = route("search/route.ts");
  const result = await (await api.GET(new Request("http://localhost/search?surface=dashboard_terminal&q=resonance"))).json();
  assert.equal(result.results.length, 2);
  assert.ok(result.results.some((hit) => hit.title === "EM 1: Workspace: Circuit question"));
  assert.ok(result.results.some((hit) => hit.title === "EM 2: Assistant: Circuit question"));
  const origin = await (await api.GET(new Request("http://localhost/search?surface=dashboard_terminal&q=Workspace"))).json();
  assert.deepEqual(origin.results.map((hit) => hit.id), [workspace.public_id]);
  const scoped = await (await api.GET(new Request("http://localhost/search?surface=garden_chat&gardenSlug=em-1&q=resonance"))).json();
  assert.deepEqual(scoped.results.map((hit) => hit.id), [String(workspace.legacy_chat_session_id)]);
});

test("hub replies keep source context and synchronize back into the original workspace", () => {
  const chat = gardenChat();
  const requestedSurface = surfacePolicy.conversationRequestSurface(chat, "dashboard_terminal");
  assert.equal(requestedSurface, "garden_chat");
  assert.equal(surfacePolicy.conversationRequestSurface(chat, "quartz_ai"), "quartz_ai", "other surfaces retain their mismatch for the runtime to reject");
  assert.deepEqual(surfacePolicy.conversationRequestContext(chat, "dashboard_terminal", {}), { activeGardenSlug: "em-1", activePageSlug: null });
  runtime.createRuntimeSession({ conversationId: chat.id, surface: chat.surface, userId: 1, chatSessionId: chat.legacy_chat_session_id, agentName: "breadboard-assistant", clusterId: 10, gardenId: "em-1", pageSlug: "resonance", workspaceKey: "hub-test", activeDirectory: dataRoot, filesystemMode: "restricted" });
  assert.deepEqual(surfacePolicy.conversationRequestContext(chat, "dashboard_terminal", { activeGardenSlug: "em-2", selectedText: "quoted text" }), { activeGardenSlug: "em-1", activePageSlug: "resonance", selectedText: "quoted text" });
  finish(chat, "hub-reply", "A follow-up from the terminal", "The shared answer");
  const legacy = db.prepare("SELECT content FROM chat_messages WHERE session_id = ? ORDER BY order_index").all(chat.legacy_chat_session_id);
  assert.deepEqual(legacy.map((message) => message.content), ["A follow-up from the terminal", "The shared answer"]);
  const renamed = store.renameConversation(chat, "Renamed chat");
  assert.equal(presentation.presentHermesSessionSummary(renamed).originLabel, "EM 1: Workspace");
  assert.equal(renamed.title, "Renamed chat");
});

test("message and event endpoints resolve a terminal viewer to the original runtime context", async () => {
  const chat = gardenChat();
  const received = [];
  const modules = {
    "@/lib/conversations/turn-service.ts": { startConversationTurn: async (input) => { received.push(input); return { accepted: true, run: { id: "run-test" } }; } },
    "@/lib/conversations/branch-history.ts": { parseConversationBranchHistory: () => null },
    "@/lib/chat-text-selection.ts": { normalizeChatTextSelectionReference: () => null },
    "@/lib/chat-attachments-request.ts": { parseChatAttachments: () => [] },
    "@/lib/document-attachments-server.ts": { resolveDocumentAttachments: () => [] },
    "@/lib/colpali/retrieval.ts": { retrieveDocumentAttachments: async () => [] },
    "@/lib/hermes/current-location-context.ts": { parseCurrentLocationPayload: () => null },
    "@/lib/schedules/receipt-server.ts": { scheduledChatReceiptForUser: () => null },
    "@/lib/supervisor-control.ts": { SupervisorResourceExhaustedError: class extends Error {} },
    "@/lib/hermes/session-service.ts": { resolveConversationRuntime: async (input) => { received.push(input); return {}; } },
    "@/lib/hermes/event-stream.ts": { buildSessionEventStream: () => new Response("events") },
    "@/lib/conversations/direct-turn-service.ts": { startDirectProviderTurn: async (input) => { received.push(input); return new Response("answer"); } },
  };
  const params = { params: Promise.resolve({ sessionId: chat.public_id }) };
  for (const endpoint of ["messages", "direct"]) {
    const api = route(`[sessionId]/${endpoint}/route.ts`, modules);
    const response = await api.POST(new Request("http://localhost/chat", { method: "POST", body: JSON.stringify({ surface: "dashboard_terminal", text: "A terminal follow-up", clientMessageId: "terminal-follow-up" }) }), params);
    assert.equal(response.status, 200, await response.text());
  }
  const response = await route("[sessionId]/events/route.ts", modules).GET(new Request("http://localhost/events?surface=dashboard_terminal"), params);
  assert.equal(response.status, 200);
  assert.ok(received.every((input) => input.surface === "garden_chat" && input.conversation.public_id === chat.public_id));
  assert.equal(received[0].surfaceContext.activeGardenSlug, "em-1");
  assert.equal(received[2].activeGardenSlug, "em-1");
});

test("history versions detect an answer arriving after its pending placeholder", () => {
  const chat = gardenChat();
  store.reserveConversationTurn({ conversation: chat, clientMessageId: "pending-reply", surface: chat.surface, content: "Explain this" });
  const pending = store.summarizeConversationMessages([chat.id]).get(chat.id);
  store.completeAssistantMessage({ conversationId: chat.id, clientMessageId: "pending-reply", content: "The answer from another surface" });
  const completed = store.summarizeConversationMessages([chat.id]).get(chat.id);
  assert.equal(pending.messageCount, completed.messageCount);
  assert.notEqual(pending.transcriptVersion, completed.transcriptVersion);
  assert.equal(pending.pendingMessageCount, 1);
  assert.equal(completed.pendingMessageCount, 0);
});

test("Clicky persists questions and replies in one labeled hub conversation", async () => {
  notificationStore.ensureChatNotificationBaseline(db, 1);
  const created = await route("../../clicky/sessions/route.ts").POST();
  const { conversationId } = await created.json();
  const inputs = [];
  const api = route("../../clicky/chat/route.ts", {
    "node:crypto": { default: crypto },
    openai: { default: class { responses = { create: async (input) => { inputs.push(input); return { status: "completed", output_text: "Clicky answer" }; } }; } },
    "@/lib/chatmock-server": { resolveChatmockBaseUrl: () => ({ baseURL: "http://localhost" }) },
    "@/lib/ai-models": { GLOBAL_MODEL_SENTINEL: "test-model" },
    "@/lib/clicky/companion": clicky,
  });
  async function ask(content, id = conversationId) {
    return api.POST(new Request("http://localhost/clicky/chat", { method: "POST", body: JSON.stringify({ conversationId: id, messages: [{ role: "user", content }], snapshots: [] }) }));
  }
  assert.equal((await ask("Explain my screen")).status, 200);
  const chat = store.getConversationForUser(conversationId, 1);
  assert.equal(presentation.presentHermesSessionSummary(chat).originLabel, "Clicky");
  assert.equal(
    notificationStore.listPendingChatNotifications(db, 1)
      .some((notice) => notice.target.chatId === conversationId),
    false,
    "the answer already visible in Clicky must not enter the notification inbox",
  );
  finish(chat, "terminal-clicky-followup", "A question from the hub", "Hub answer");
  assert.equal((await ask("And the next step?")).status, 200);
  const transcript = presentation.presentHermesSessionDetail(chat).messages;
  assert.equal(transcript.length, 6);
  assert.equal(transcript.at(-1).content, "Clicky answer");
  assert.ok(inputs[1].input.some((message) => message.content === "Hub answer"));
  const result = await (await route("search/route.ts").GET(new Request("http://localhost/search?surface=dashboard_terminal&q=Clicky"))).json();
  assert.equal(result.results[0].title, "Clicky: Explain my screen");
  const foreign = store.createConversation({ userId: 2, originLabel: "Clicky" });
  assert.equal((await ask("Cannot write here", foreign.public_id)).status, 404);
  const terminal = store.createConversation({ userId: 1 });
  assert.equal((await ask("Cannot relabel this", terminal.public_id)).status, 404);
});

test("changes from every surface invalidate the terminal summary cache", async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => {
    count += 1;
    return Response.json({ sessions: [{ id: `conv_${count}` }] });
  };
  try {
    client.invalidateHermesSessionSummaries();
    await client.loadHermesSessionSummaries("dashboard_terminal");
    await client.loadHermesSessionSummaries("dashboard_terminal");
    assert.equal(count, 1);
    for (const surface of ["garden_chat", "quartz_ai"]) {
      client.invalidateHermesSessionSummaries(surface);
      await client.loadHermesSessionSummaries("dashboard_terminal");
    }
    assert.equal(count, 3);
  } finally {
    globalThis.fetch = originalFetch;
    client.invalidateHermesSessionSummaries();
  }
});
