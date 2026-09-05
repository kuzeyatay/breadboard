import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "breadboard-garden-turn-crash-"),
);
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const workspaceSource = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);
const checkpointRouteSource = fs.readFileSync(
  new URL("../src/app/api/chat-sessions/[sessionId]/turns/route.ts", import.meta.url),
  "utf8",
);
const gardenAdapterSource = fs.readFileSync(
  new URL("../src/lib/hermes/garden-chat-adapter.ts", import.meta.url),
  "utf8",
);

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM hermes_runs;
    DELETE FROM hermes_runtime_sessions;
    DELETE FROM conversation_messages;
    DELETE FROM conversations;
    DELETE FROM chat_messages;
    DELETE FROM chat_sessions;
    DELETE FROM clusters;
    DELETE FROM users;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
  db.prepare(
    "INSERT INTO clusters(id, slug, name, user_id) VALUES (1, 'garden', 'Garden', 1)",
  ).run();
  db.prepare(
    "INSERT INTO chat_sessions(id, cluster_id, user_id, title) VALUES (1, 1, 1, 'New chat')",
  ).run();
});

test("a Garden checkpoint atomically persists both halves and stale preparation becomes visible failure", () => {
  const conversation = store.ensureConversationForLegacyChatSession(1, 1);
  const turn = store.reserveConversationTurn({
    conversation,
    clientMessageId: "garden-turn-1",
    surface: "garden_chat",
    content: "Draw the architecture diagram",
    metadata: { gardenPreDispatch: true },
  });

  const before = db.prepare(`
    SELECT role, content, runtime_status, canonical_message_id
    FROM chat_messages WHERE session_id = 1 ORDER BY order_index
  `).all();
  assert.deepEqual(
    before.map((row) => [row.role, row.content, row.runtime_status]),
    [
      ["user", "Draw the architecture diagram", "complete"],
      ["assistant", "", "pending"],
    ],
  );
  assert.equal(before[0].canonical_message_id, turn.userMessage.id);
  assert.equal(before[1].canonical_message_id, turn.assistantMessage.id);

  const failed = store.failStaleGardenPreDispatchTurns({
    chatSessionIds: [1],
    staleBefore: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(failed, 1);

  const legacy = db.prepare(`
    SELECT content, runtime_status, runtime_error
    FROM chat_messages WHERE session_id = 1 AND role = 'assistant'
  `).get();
  assert.equal(legacy.runtime_status, "failed");
  assert.equal(legacy.runtime_error, "garden_dispatch_interrupted");
  assert.match(legacy.content, /interrupted/i);

  const canonical = db.prepare(`
    SELECT status, content
    FROM conversation_messages
    WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
  `).get(conversation.id, "garden-turn-1");
  assert.equal(canonical.status, "failed");
  assert.match(canonical.content, /interrupted/i);
});

test("replaying a canonical completion repairs a stale Garden browser projection", () => {
  const conversation = store.ensureConversationForLegacyChatSession(1, 1);
  store.reserveConversationTurn({
    conversation,
    clientMessageId: "garden-turn-network-drop",
    surface: "garden_chat",
    content: "Build an interactive visualizer",
    metadata: { gardenPreDispatch: true },
  });
  const completed = store.completeAssistantMessage({
    conversationId: conversation.id,
    clientMessageId: "garden-turn-network-drop",
    content: "The interactive visualizer is ready.",
    metadata: { runtimeStatus: "idle" },
  });
  const completedMetadata = JSON.parse(completed.metadata);
  assert.ok(
    Number.isFinite(Date.parse(completedMetadata.responseCompletedAt)),
    "completion stores the exact terminal timestamp",
  );

  db.prepare(`
    UPDATE chat_messages
       SET content = 'network error', runtime_status = 'complete'
     WHERE session_id = 1 AND role = 'assistant'
  `).run();

  store.completeAssistantMessage({
    conversationId: conversation.id,
    clientMessageId: "garden-turn-network-drop",
    content: "This replay must not replace the canonical result.",
  });

  const legacy = db.prepare(`
    SELECT content, runtime_status
      FROM chat_messages
     WHERE session_id = 1 AND role = 'assistant'
  `).get();
  assert.equal(legacy.content, "The interactive visualizer is ready.");
  assert.equal(legacy.runtime_status, "complete");
});

test("Stop seals a Garden turn before runtime dispatch can revive it", () => {
  const conversation = store.ensureConversationForLegacyChatSession(1, 1);
  store.reserveConversationTurn({
    conversation,
    clientMessageId: "garden-turn-stopped-before-runtime",
    surface: "garden_chat",
    content: "/chapter-creation",
    metadata: {
      gardenPreDispatch: true,
      focusedDocumentNames: ["lecture.pdf"],
      focusedDocumentSlugs: ["lecture"],
    },
  });

  const cancelled = store.cancelConversationTurn({
    conversationId: conversation.id,
    clientMessageId: "garden-turn-stopped-before-runtime",
  });
  assert.equal(cancelled.status, "aborted");
  assert.equal(
    store.conversationTurnWasCancelled(
      conversation.id,
      "garden-turn-stopped-before-runtime",
    ),
    true,
  );

  const metadata = JSON.parse(cancelled.metadata);
  assert.equal(metadata.error, "cancelled_by_user");
  assert.deepEqual(metadata.focusedDocumentSlugs, ["lecture"]);
  const legacy = db.prepare(`
    SELECT runtime_status, runtime_error
    FROM chat_messages WHERE session_id = 1 AND role = 'assistant'
  `).get();
  assert.equal(legacy.runtime_status, "aborted");
  assert.equal(legacy.runtime_error, "cancelled_by_user");
});

test("Stop converts a recoverable first-turn placeholder into a terminal cancellation", () => {
  const created = store.createConversationWithInitialTurn({
    conversation: {
      userId: 1,
      title: "New chat",
      surface: "garden_chat",
      scopeKind: "garden",
      defaultGardenId: 1,
    },
    turn: {
      clientMessageId: "reserved-first-turn",
      surface: "garden_chat",
      content: "/chapter-creation",
      metadata: { preDispatchRecovery: { agentMode: true } },
    },
  });
  assert.equal(
    store.isPreDispatchReservedAssistant(created.turn.assistantMessage),
    true,
  );

  const cancelled = store.cancelLatestConversationTurn(
    created.conversation.id,
  );
  assert.equal(cancelled.status, "aborted");
  assert.equal(store.isPreDispatchReservedAssistant(cancelled), false);
  assert.equal(
    store.conversationTurnWasCancelled(
      created.conversation.id,
      "reserved-first-turn",
    ),
    true,
  );
});

test("Garden Stop is durable before a runtime id exists and blocks late dispatch", () => {
  assert.match(checkpointRouteSource, /export async function DELETE/);
  assert.match(checkpointRouteSource, /cancelConversationTurn\(/);
  assert.match(workspaceSource, /abortGardenTurnCheckpoint\(/);
  assert.match(workspaceSource, /agentActivity\.bindSession\(/);
  assert.match(
    gardenAdapterSource,
    /conversationTurnWasCancelled\([\s\S]*?beginRuntimeRun\(/,
  );
});
