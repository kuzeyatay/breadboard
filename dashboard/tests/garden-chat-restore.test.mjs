import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-chat-restore-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const turns = await import("../src/lib/conversations/external-agent-turns.ts");
const { delegatedWorkersForMessage, interruptedDelegationMessage } = await import("../src/lib/hermes/super-agent-activity.ts");

test("Garden history reconciles interrupted workers and preserves completed answers on reload", async () => {
  const observed = [];
  let terminal = null;
  globalThis.gardenRestoreFixture = { db, store, turns, observed, getTerminalResult: async () => terminal };
  try {
    db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')").run();
    db.prepare("INSERT INTO clusters(id, slug, name, user_id) VALUES (1, 'health', 'Health', 1)").run();
    db.prepare("INSERT INTO chat_sessions(id, cluster_id, user_id, title) VALUES (1, 1, 1, 'Research')").run();
    const conversation = store.ensureConversationForLegacyChatSession(1, 1);
    const workerId = "agent-launch-research-worker";
    const workerMetadata = {
      internalAgentContinuation: true,
      externalAgent: true,
      delegatedAgentRun: true,
      externalAgentRun: { kind: "max_research", runId: "job_research", query: "Research hypertrophy" },
      externalAgentOutcome: "completed",
      externalAgentResult: "The collected findings.",
    };
    store.reserveConversationTurn({ conversation, clientMessageId: workerId, surface: "garden_chat", content: "Research hypertrophy", metadata: workerMetadata });
    store.completeAssistantMessage({ conversationId: conversation.id, clientMessageId: workerId, content: "", metadata: workerMetadata });
    store.reserveConversationTurn({ conversation, clientMessageId: "research-synthesis", surface: "garden_chat", content: `<!-- agent-launch-result:${workerId} -->\nThe findings.`, metadata: { internalAgentContinuation: true } });
    store.completeAssistantMessage({ conversationId: conversation.id, clientMessageId: "research-synthesis", content: "The full completed research answer.", metadata: { internalAgentContinuation: true } });

    db.prepare("INSERT INTO chat_sessions(id, cluster_id, user_id, title) VALUES (2, 1, 1, 'Interrupted research')").run();
    const interruptedChat = store.ensureConversationForLegacyChatSession(2, 1);
    store.reserveConversationTurn({ conversation: interruptedChat, clientMessageId: "research-request", surface: "garden_chat", content: "Research muscle growth" });
    store.completeAssistantMessage({ conversationId: interruptedChat.id, clientMessageId: "research-request", content: "Research is reviewing the evidence.", metadata: { responseStartedAt: "2026-09-07T05:37:52.492Z", verification: { externalAgents: [{ agentName: "Max Research" }] } } });
    const interruptedWorker = turns.recordExternalAgentTurn({
      conversation: store.getConversationById(interruptedChat.id), clientMessageId: "agent-launch-interrupted", surface: "garden_chat",
      userContent: "Research the evidence", assistantContent: "", delegatedAgentRun: true, internalAgentContinuation: true,
      run: { kind: "max_research", runId: "job_interrupted", query: "Research the evidence" },
    });

    const stubs = {
      "next/server": "export const NextResponse = Response;",
      "next-auth/next": "export const getServerSession = async () => ({ user: { id: '1' } });",
      "@/lib/auth-options": "export const authOptions = {};",
      "@/lib/db": "export default globalThis.gardenRestoreFixture.db;",
      "@/lib/conversations/store": "export const {ensureConversationForLegacyChatSession, failStaleGardenPreDispatchTurns, summarizeConversationMessages} = globalThis.gardenRestoreFixture.store;",
      "../db.ts": "export default globalThis.gardenRestoreFixture.db;",
      "../conversations/external-agent-turns.ts": "export const {finishExternalAgentTurn, reconcileExternalAgentTerminalTiming} = globalThis.gardenRestoreFixture.turns;",
      "./runtime-run-manager.ts": "export const getTerminalResult = (...args) => globalThis.gardenRestoreFixture.getTerminalResult(...args); export const setRunTerminalHandler = (...args) => globalThis.gardenRestoreFixture.observed.push(args);",
    };
    const bundle = await build({
      entryPoints: [fileURLToPath(new URL("../src/app/api/chat-sessions/route.ts", import.meta.url))],
      bundle: true, write: false, platform: "node", format: "esm",
      plugins: [{ name: "isolated-chat-services", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "stub" } : null);
        builder.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: stubs[args.path], loader: "js" }));
      } }],
    });
    const route = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
    // A browser-only worker save must keep its identity even before the next
    // process-start backfill binds its legacy rows to canonical messages.
    db.prepare("INSERT INTO chat_sessions(id, cluster_id, user_id, title) VALUES (3, 1, 1, 'Gym')").run();
    const gymMetadata = JSON.stringify({ clientMessageId: "agent-launch-gym-worker", internalAgentContinuation: true });
    db.prepare("INSERT INTO chat_messages(session_id,role,content,order_index,tool_calls) VALUES(3,'user','Private gym brief',0,?)").run(gymMetadata);
    const gymHistory = await (await route.GET(new Request("http://localhost/api/chat-sessions?clusterSlug=health&sessionId=3"))).json();
    assert.equal(gymHistory.sessions[0].messages[0].clientMessageId, "agent-launch-gym-worker");
    assert.equal(gymHistory.sessions[0].messages[0].internalAgentContinuation, true);
    const request = () => route.GET(new Request("http://localhost/api/chat-sessions?clusterSlug=health&sessionId=2"));
    // A live run remains live; a transient disconnect is not an interruption.
    const live = await (await request()).json();
    assert.equal(live.sessions[0].active, true);
    assert.equal(observed.at(-1)[1], "job_interrupted");
    terminal = { outcome: "aborted", content: "Interrupted", terminalAtMs: Date.parse("2026-09-07T07:29:03.897Z") };
    for (let reload = 0; reload < 2; reload++) {
      const restored = await (await request()).json();
      const chat = restored.sessions[0];
      const parent = chat.messages[1];
      const visible = interruptedDelegationMessage(parent, delegatedWorkersForMessage(chat.messages, 1));
      assert.equal(chat.active, false, "the same response must already report that the run stopped");
      assert.equal(visible.content, "Interrupted");
      assert.equal(visible.interrupted, true);
      assert.equal(visible.responseCompletedAt, "2026-09-07T07:29:03.897Z");
      assert.equal(chat.messages[0].content, "Research muscle growth");
      assert.equal(chat.messages.at(-1).externalAgentOutcome, "aborted");
      const saved = store.getConversationMessageById(interruptedWorker.assistantMessage.id);
      assert.equal(saved.status, "aborted");
      assert.equal(JSON.parse(saved.metadata).externalAgentResult, "Interrupted");
    }
    terminal = null;
    for (let reload = 0; reload < 2; reload++) {
      const response = await route.GET(new Request("http://localhost/api/chat-sessions?clusterSlug=health&sessionId=1"));
      assert.equal(response.status, 200);
      const { sessions } = await response.json();
      const messages = sessions[0].messages;
      const worker = messages.find(m => m.role === "assistant" && m.maxResearchRun);
      assert.equal(worker.clientMessageId, workerId, "reload must keep the same continuation key used on first delivery");
      const continuedIds = messages.filter(m => m.role === "user" && m.internalAgentContinuation)
        .flatMap(m => [...m.content.matchAll(/<!-- agent-launch-result:([^>]+) -->/g)].map(match => match[1]));
      assert.ok(continuedIds.includes(worker.clientMessageId), "the already consumed worker must not be synthesized again");
      assert.equal(messages.at(-1).clientMessageId, "research-synthesis");
      assert.equal(messages.at(-1).content, "The full completed research answer.");
      assert.equal(messages.at(-1).internalAgentContinuation, undefined, "only the hand-back prompt is hidden");
      assert.equal(sessions[0].active, false);
    }
  } finally {
    delete globalThis.gardenRestoreFixture;
    db.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
