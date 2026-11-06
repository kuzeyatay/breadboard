import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import ts from "typescript";
import esbuild from "esbuild";
import { chromium } from "playwright";
import { acquireDetachedEventPump, waitForDetachedEventPumps } from "../src/lib/hermes/detached-event-pump.ts";
import { mergeProgressNote, mergeThinkingDetail } from "../src/lib/hermes/stream-progress.ts";
import { createResponseTextRecovery, reasoningTextFromOutputItem, assistantTextFromOutputItem } from "../src/lib/responses-stream-text.ts";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-thinking-restore-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const { persistAssistantProgress } = await import("../src/lib/conversations/live-progress.ts");
const { presentHermesSessionDetail } = await import("../src/lib/hermes/session-presentation.ts");
db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'reader', 'reader@example.test', 'x')").run();
db.prepare("INSERT INTO clusters(id, slug, name, user_id) VALUES (1, 'thinking', 'Thinking', 1)").run();

// Garden tabs reload through this endpoint, whose legacy projection is not
// read by the terminal session presenter used in the other checks below.
globalThis.thinkingRestoreFixture = { db, store };
const historyStubs = {
  "next/server": "export const NextResponse = Response;",
  "next-auth/next": "export const getServerSession = async () => ({ user: { id: '1' } });",
  "@/lib/auth-options": "export const authOptions = {};",
  "@/lib/db": "export default globalThis.thinkingRestoreFixture.db;",
  "../db.ts": "export default globalThis.thinkingRestoreFixture.db;",
  "@/lib/conversations/store": "export const {ensureConversationForLegacyChatSession, failStaleGardenPreDispatchTurns, summarizeConversationMessages} = globalThis.thinkingRestoreFixture.store;",
  "./store.ts": "export const {ConversationStoreError, getConversationMessageById} = globalThis.thinkingRestoreFixture.store;",
  "@/lib/max-research/conversation-persistence.ts": "export const reconcileMaxResearchConversation = async () => {};",
  "@/lib/hermes/chat-runtime-control.ts": "export const readChatRuntimeControl = () => null;",
};
const historyBundle = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../src/app/api/chat-sessions/route.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
  plugins: [{ name: "isolated-history-services", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in historyStubs ? { path: args.path, namespace: "stub" } : null);
    builder.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: historyStubs[args.path], loader: "js" }));
  } }],
});
const historyRoute = await import(`data:text/javascript;base64,${Buffer.from(historyBundle.outputFiles[0].text).toString("base64")}`);
after(() => { delete globalThis.thinkingRestoreFixture; db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

function newTurn(surface = "dashboard_terminal", clientMessageId = crypto.randomUUID()) {
  const conversation = store.createConversation({ userId: 1, title: "Thinking restore", surface,
    ...(surface === "garden_chat" ? { defaultGardenId: 1, linkToGardenWorkspace: true } : {}),
  });
  store.reserveConversationTurn({ conversation, clientMessageId, surface, content: "Compare these notes", metadata: { responseStartedAt: new Date().toISOString(), retained: true } });
  return { conversation, conversationId: conversation.id, clientMessageId };
}

function restore(turn) {
  return presentHermesSessionDetail(turn.conversation).messages.find(message => message.role === "assistant");
}

async function restoreGarden(turn) {
  const response = await historyRoute.GET(new Request(`http://localhost/api/chat-sessions?clusterSlug=thinking&sessionId=${turn.conversation.legacy_chat_session_id}`));
  assert.equal(response.status, 200);
  const { sessions } = await response.json();
  return sessions[0].messages.find(message => message.role === "assistant");
}

test("Garden history restores live thinking without touching other turns or settled responses", async () => {
  const turn = newTurn("garden_chat");
  const other = newTurn("garden_chat", turn.clientMessageId);
  const historyRows = current => db.prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY order_index").all(current.conversation.legacy_chat_session_id);
  const before = historyRows(turn);
  const otherBefore = historyRows(other);
  persistAssistantProgress({ ...turn, reasoning: "Comparing the source notes." });
  persistAssistantProgress({ ...turn, progressNotes: ["Read the first source."] });
  const message = await restoreGarden(turn);
  assert.equal(message.pending, true);
  assert.equal(message.content, "");
  assert.equal(message.thinking, "Comparing the source notes.");
  assert.deepEqual(message.progressNotes, ["Read the first source."]);
  const after = historyRows(turn);
  assert.deepEqual(after[0], before[0], "the user message must not change");
  assert.equal(JSON.parse(after[1].tool_calls).retained, true);
  assert.deepEqual(historyRows(other), otherBefore, "a reused client id cannot update another conversation");

  for (const status of ["complete", "aborted", "failed"]) {
    const settled = newTurn("garden_chat");
    persistAssistantProgress({ ...settled, reasoning: "Saved thinking." });
    if (status === "complete") store.completeAssistantMessage({ ...settled, content: "Finished answer." });
    else store.failAssistantMessage({ ...settled, status, content: "Partial answer." });
    const saved = historyRows(settled);
    persistAssistantProgress({ ...settled, reasoning: "Late event", progressNotes: ["Late note"] });
    assert.deepEqual(historyRows(settled), saved, `${status} history must remain unchanged`);
    assert.equal((await restoreGarden(settled)).thinking, "Saved thinking.");
  }
});

test("a running turn restores thinking without changing its answer, ownership, or status", () => {
  const turn = newTurn();
  const other = newTurn();
  persistAssistantProgress({ ...turn, reasoning: "Comparing the source notes." });
  persistAssistantProgress({ ...turn, progressNotes: ["Read the first source.", "Read the second source."] });
  const message = restore(turn);
  assert.equal(message.pending, true);
  assert.equal(message.content, "");
  assert.equal(message.reasoning, "Comparing the source notes.");
  assert.deepEqual(message.progressNotes, ["Read the first source.", "Read the second source."]);
  assert.equal(restore(other).reasoning, undefined);
  const rows = store.listConversationMessages(turn.conversationId);
  assert.equal(JSON.parse(rows[0].metadata).reasoning, undefined, "the user message is not a progress checkpoint");
  assert.equal(JSON.parse(rows[1].metadata).retained, true);

  for (const status of ["complete", "aborted", "failed"]) {
    const settled = newTurn();
    persistAssistantProgress({ ...settled, reasoning: "Saved thinking." });
    if (status === "complete") store.completeAssistantMessage({ ...settled, content: "Finished answer." });
    else store.failAssistantMessage({ ...settled, status, content: "Partial answer." });
    const before = store.listConversationMessages(settled.conversationId);
    persistAssistantProgress({ ...settled, reasoning: "Late event", progressNotes: ["Late note"] });
    assert.deepEqual(store.listConversationMessages(settled.conversationId), before, `${status} must remain unchanged`);
  }
});

test("replaying thinking checkpoints is idempotent and live updates still append or replace", () => {
  let reasoning = "Read both sources. Compare the examples.";
  assert.equal(mergeThinkingDetail(reasoning, "Read both sources.", "append", 0), reasoning);
  assert.equal(mergeThinkingDetail(reasoning, " Compare the examples.", "append", 18), reasoning);
  reasoning = mergeThinkingDetail(reasoning, " Check the result.", "append", reasoning.length);
  assert.equal(reasoning, "Read both sources. Compare the examples. Check the result.");
  assert.equal(mergeThinkingDetail(reasoning, "Updated summary.", "replace", reasoning.length), "Updated summary.");
  assert.equal(mergeThinkingDetail("Legacy", " delta", undefined, undefined), "Legacy delta");
  let notes = ["First source.", "Second source."];
  notes = mergeProgressNote(notes, "First source.", 0);
  notes = mergeProgressNote(notes, "Second source.", 1);
  assert.deepEqual(notes, ["First source.", "Second source."]);
  assert.deepEqual(mergeProgressNote(notes, "Third source.", 2), [...notes, "Third source."]);
});

function eventLoop(file, expression, scope, setup) {
  const source = fs.readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let loop;
  function visit(node) {
    if (ts.isForOfStatement(node) && node.awaitModifier && node.expression.getText(tree) === expression) loop = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(loop, `production event loop for ${expression}`);
  const compiled = ts.transpileModule(`async function run() { ${setup}\n${loop.getText(tree)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn run;`)(...Object.values(scope));
}

test('a writer event arriving after cancellation cannot be published as a finished answer', async () => {
  const source=fs.readFileSync(new URL('../src/lib/hermes/event-stream.ts',import.meta.url),'utf8');
  const tree=ts.createSourceFile('stream.ts',source,ts.ScriptTarget.Latest,true);
  let completion;
  function visit(node) {
    if(ts.isIfStatement(node)&&node.expression.getText(tree)==='event.type === "session.status" && event.payload.status === "idle" && sawTurnOutput')completion=node.getText(tree);
    ts.forEachChild(node,visit);
  }
  visit(tree);
  assert.ok(completion);
  const code=ts.transpileModule(`
    let forwardEvent=true,lostRunOwnership=false;const sawTurnOutput=true,streamRun={id:'stopped'};
    const event={type:'session.status',payload:{status:'idle'}};
    const promoteNarrationFallback=()=>{},getRuntimeRun=()=>({status:'cancelled'});
    function finish(){${completion};throw new Error('A cancelled run cannot publish');}
    finish();return lostRunOwnership;
  `,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  assert.equal(new Function(code)(),true);
});

test("direct provider deltas and completed reasoning items checkpoint before the answer", async () => {
  const turn = newTurn();
  const emitted = [];
  await eventLoop("conversations/direct-turn-service.ts", "stream", {
    input: turn, persistAssistantProgress, createResponseTextRecovery,
    reasoningTextFromOutputItem, assistantTextFromOutputItem,
    emit(event) {
      emitted.push(event);
      assert.equal(restore(turn).pending, true);
      assert.equal(restore(turn).content, "");
      assert.equal(restore(turn).reasoning, emitted.map(item => item.text).join(""));
    },
    stream: (async function* () {
      yield { type: "response.reasoning_summary_text.delta", output_index: 0, delta: "Comparing notes." };
      yield { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", summary: [{ type: "summary_text", text: "Comparing notes." }] } };
      yield { type: "response.output_item.done", output_index: 1, item: { type: "reasoning", summary: [{ type: "summary_text", text: " Checking examples." }] } };
    })(),
  }, `let reasoning = ''; const thinkingRecovery = createResponseTextRecovery(); const answerRecovery = createResponseTextRecovery();`)();
  assert.equal(emitted.length, 2, "finished items do not duplicate streamed summaries");
});

test("the session event pump saves progress and emits positions for replay over that checkpoint", async () => {
  const turn = newTurn();
  const emitted = [];
  const events = [
    { type: "reasoning.status", payload: { label: "Thinking", detail: "Read sources." } },
    { type: "reasoning.status", payload: { label: "Thinking", detail: " Check examples." } },
    { type: "assistant.segment", messageId: "current", payload: { text: "First source.", streamed: false } },
    { type: "assistant.segment", messageId: "old-turn", payload: { text: "Wrong source.", streamed: false } },
    { type: "assistant.segment", messageId: "current", payload: { text: "Second source.", streamed: false } },
  ];
  await eventLoop("hermes/event-stream.ts", "subscribeAcrossRebinds()", {
    session: { row: { conversation_id: turn.conversationId } },
    db, persistAssistantProgress,
    subscribeAcrossRebinds: async function* () { yield* events; },
    getRuntimeRun: () => ({ status: "active" }),
    parseRuntimeRunDispatch: () => ({ clientMessageId: turn.clientMessageId }),
    hydrateGardenGrounding: () => {}, hydrateProductSearch: () => {}, clearDispatchDeadline: () => {},
    emit: event => emitted.push(structuredClone(event)),
    emitArtifactEvents: () => {}, emitAgentLaunchRequests: () => {},
  }, `let sawRuntimeEvent, lastRuntimeEventAt, awaitingPermission, sawTurnOutput, teachingDeadlineStop;
      let streamRun = {id: 'run'}, assistantMessageId = 'current', assistantText = '', reasoning = '';
      const narrationSegments = [];`)();
  const restored = restore(turn);
  assert.equal(restored.pending, true);
  assert.equal(restored.reasoning, "Read sources. Check examples.");
  assert.deepEqual(restored.progressNotes, ["First source.", "Second source."]);
  assert.deepEqual(emitted.filter(event => event.type === "reasoning.status").map(event => event.payload.detailOffset), [0, 13]);
  assert.deepEqual(emitted.filter(event => event.type === "assistant.segment").map(event => event.payload.progressIndex), [0, 1]);
  let { reasoning, progressNotes } = restored;
  for (const { type, payload } of emitted) {
    if (type === "reasoning.status") reasoning = mergeThinkingDetail(reasoning, payload.detail, payload.detailMode, payload.detailOffset);
    if (type === "assistant.segment") progressNotes = mergeProgressNote(progressNotes, payload.text, payload.progressIndex);
  }
  assert.equal(reasoning, restored.reasoning);
  assert.deepEqual(progressNotes, restored.progressNotes);
});

// Execute the production stream driver; only the runtime/services outside the
// progress path are fixtures. Its real SQL checkpoints feed the restored UI.
function gardenDriver(scope) {
  const source = fs.readFileSync(new URL("../src/lib/hermes/garden-chat-adapter.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("adapter.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "legacyGardenEventStream");
  const compiled = ts.transpileModule(declaration.getText(tree), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn legacyGardenEventStream;`)(...Object.values(scope));
}


test("refreshing during a real Garden stream keeps the Thinking dropdown available", { timeout: 60_000 }, async () => {
  const turn = newTurn("garden_chat");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const runtime = {
    async *streamSession(_context, _signal, connected) {
      connected();
      yield { type: "reasoning.status", payload: { detail: "Comparing the source notes." } };
      yield { type: "reasoning.status", payload: { detail: " Checking the examples." } };
      yield { type: "assistant.segment", payload: { text: "I checked the first source.", streamed: false } };
      yield { type: "assistant.segment", payload: { text: "I checked the second source.", streamed: false } };
      await gate;
      // End the fixture's runtime on cleanup; it must persist even this failed
      // terminal state without losing the progress already shown.
    },
    stopRun: async () => {},
  };
  const drive = gardenDriver({
    getAgentRuntimeByKind: () => runtime,
    acquireDetachedEventPump, persistAssistantProgress,
    listAgentLaunchRequestsAfter: () => [], listArtifactEventsAfter: () => [],
    touchRuntimeRunHeartbeat: () => {}, markRuntimeRunSubmitted: () => {},
    RUN_HEARTBEAT_INTERVAL_MS: 60_000,
    markStatus: () => {}, finishRuntimeRun: () => {}, revokeCapabilityDecision: () => {}, recordAuditEvent: () => {},
    failAssistantMessage: store.failAssistantMessage,
  });
  const response = drive(
    { runtimeKind: "hermes", row: { id: turn.conversationId, conversation_id: turn.conversationId } },
    new AbortController().signal,
    { plan: { steps: [] }, grant: { grantedCapabilities: [] }, pendingPermissions: [] },
    `thinking-${turn.clientMessageId}`, turn.clientMessageId, {}, false, async () => {}, async () => {},
  );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    let streamed = "";
    while (!streamed.includes("I checked the second source.")) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, streamed);
      streamed += decoder.decode(chunk.value);
    }
    assert.equal(restore(turn).pending, true);
    assert.equal(restore(turn).reasoning, "Comparing the source notes. Checking the examples.");
    assert.deepEqual(restore(turn).progressNotes, ["I checked the first source.", "I checked the second source."]);

    const root = fileURLToPath(new URL("../", import.meta.url));
    const bundle = await esbuild.build({
      stdin: { resolveDir: root, loader: "tsx", contents: `
        import React, {useEffect, useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import ActivityPanel from './src/app/components/hermes/activity-panel';
        function App() {
          const [message, setMessage] = useState(null);
          useEffect(() => { fetch('/snapshot').then(r => r.json()).then(setMessage); }, []);
          return message && <ActivityPanel activities={[]} connection={message.pending ? 'streaming' : 'idle'}
            reasoning={message.thinking} progressNotes={message.progressNotes} answerContent={message.content}
            responseStartedAt={message.responseStartedAt} pendingPermission={null} onPermissionDecision={() => {}} />;
        }
        createRoot(document.getElementById('root')).render(<App/>);
      ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' }, alias: { "@": path.join(root, "src") }, logLevel: "silent",
    });
    const server = http.createServer(async (request, reply) => {
      if (request.url === "/snapshot") {
        reply.setHeader("Content-Type", "application/json");
        reply.end(JSON.stringify(await restoreGarden(turn)));
      } else if (request.url === "/app.js") {
        reply.setHeader("Content-Type", "application/javascript");
        reply.end(bundle.outputFiles[0].text);
      } else {
        reply.setHeader("Content-Type", "text/html");
        reply.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    let browser;
    try {
      const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
      browser = await chromium.launch({ headless: true, executablePath });
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      for (let refresh = 0; refresh < 3; refresh++) {
        if (refresh) await page.reload();
        await page.getByRole("button", { name: /^Thinking/ }).click();
        const updates = page.getByRole("list", { name: "Thinking updates" });
        await updates.waitFor({ state: "visible" });
        assert.equal(await updates.locator("li").count(), 3);
        assert.match(await updates.textContent(), /Comparing the source notes\. Checking the examples\./);
        assert.equal(restore(turn).pending, true, "the provider is still running during refresh");
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise(resolve => server.close(resolve));
    }
  } finally {
    release();
    await waitForDetachedEventPumps();
    await reader.cancel();
  }
});
