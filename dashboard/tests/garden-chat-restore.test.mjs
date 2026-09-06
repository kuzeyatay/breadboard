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

test("Garden history preserves worker identities and the completed synthesis on every reload", async () => {
  globalThis.gardenRestoreFixture = { db, store };
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

    const stubs = {
      "next/server": "export const NextResponse = Response;",
      "next-auth/next": "export const getServerSession = async () => ({ user: { id: '1' } });",
      "@/lib/auth-options": "export const authOptions = {};",
      "@/lib/db": "export default globalThis.gardenRestoreFixture.db;",
      "@/lib/conversations/store": "export const {ensureConversationForLegacyChatSession, failStaleGardenPreDispatchTurns, summarizeConversationMessages} = globalThis.gardenRestoreFixture.store;",
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
