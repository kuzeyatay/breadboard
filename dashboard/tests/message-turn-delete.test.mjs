import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// Deleting one exchange is the second destructive operation on the durable
// transcript, and the harder of the two: the log is append-only and
// branch-aware, so removing the two rows a reader can see is not the same as
// removing what they see. These tests pin the rule the planner has to keep —
// afterwards the visible transcript is exactly what it was, minus that one
// exchange — and the surface contract of the route and the two chats that
// call it.

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-turn-delete-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { planConversationTurnDeletion, deleteConversationMessages } = await import(
  "../src/lib/conversations/turn-delete.ts"
);
const { projectConversationBranchMessages } = await import(
  "../src/lib/conversations/branch-history.ts"
);

const routeSource = fs.readFileSync(
  path.join(
    import.meta.dirname,
    "../src/app/api/hermes/sessions/[sessionId]/messages/[clientMessageId]/route.ts",
  ),
  "utf8",
);
const panelSource = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/components/hermes/agent-runtime-panel.tsx"),
  "utf8",
);
const sessionHook = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/components/hermes/use-agent-session.ts"),
  "utf8",
);
const workspace = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/gardens/[clusterSlug]/workspace-client.tsx"),
  "utf8",
);

const conversation = { id: 1 };

function seed(rows) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE conversation_messages (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      client_message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      surface TEXT NOT NULL DEFAULT 'dashboard_terminal',
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'complete',
      order_index INTEGER NOT NULL,
      metadata TEXT,
      sources TEXT,
      token_usage TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:01.000Z');
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY,
      canonical_message_id INTEGER);
    CREATE TABLE hermes_messages (
      id INTEGER PRIMARY KEY,
      canonical_message_id INTEGER);
  `);
  const insert = db.prepare(`
    INSERT INTO conversation_messages
      (id, conversation_id, client_message_id, role, content, status, order_index, metadata)
    VALUES (@id, 1, @clientMessageId, @role, @content, @status, @orderIndex, @metadata)
  `);
  rows.forEach((row, index) => {
    insert.run({
      id: row.id,
      clientMessageId: row.clientMessageId,
      role: row.role,
      content: row.content ?? `${row.role} ${row.id}`,
      status: row.status ?? "complete",
      orderIndex: index,
      metadata: row.branchGroupId
        ? JSON.stringify({ branchGroupId: row.branchGroupId })
        : null,
    });
  });
  return db;
}

/** A turn: the message and the answer stored under the same client id. */
function turn(clientMessageId, firstRowId, branchGroupId) {
  return [
    { id: firstRowId, clientMessageId, role: "user", branchGroupId },
    { id: firstRowId + 1, clientMessageId, role: "assistant", branchGroupId },
  ];
}

const visibleIds = (db) =>
  projectConversationBranchMessages(
    db.prepare("SELECT * FROM conversation_messages ORDER BY order_index").all(),
  ).map((row) => row.id);

test("a plain turn takes its answer with it and nothing else", () => {
  const db = seed([...turn("turn-1", 1), ...turn("turn-2", 3), ...turn("turn-3", 5)]);
  const plan = planConversationTurnDeletion(
    { conversation, clientMessageId: "turn-2" },
    db,
  );

  assert.deepEqual(plan.messageIds.sort((a, b) => a - b), [3, 4]);
  deleteConversationMessages(plan.messageIds, db);
  assert.deepEqual(visibleIds(db), [1, 2, 5, 6]);
  db.close();
});

test("deleting a regenerated turn does not un-hide the version it replaced", () => {
  // The reader sees one exchange, not three. Deleting it has to remove the
  // exchange, not swap in an older attempt at the same question.
  const db = seed([
    ...turn("turn-1", 1),
    ...turn("turn-2", 3),
    ...turn("turn-2-retry-1", 5, "turn-2"),
    ...turn("turn-2-retry-2", 7, "turn-2"),
  ]);
  assert.deepEqual(visibleIds(db), [1, 2, 7, 8]);

  const plan = planConversationTurnDeletion(
    { conversation, clientMessageId: "turn-2-retry-2" },
    db,
  );
  deleteConversationMessages(plan.messageIds, db);

  assert.deepEqual(visibleIds(db), [1, 2]);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM conversation_messages").get().n,
    2,
    "the hidden attempts go too, or the deleted question comes back",
  );
  db.close();
});

test("turns the reader cannot see are neither deletable nor disturbed", () => {
  const db = seed([
    ...turn("turn-1", 1),
    ...turn("turn-2", 3),
    ...turn("turn-3", 5),
    ...turn("turn-2-edit", 7, "turn-2"),
  ]);
  // The edit replaced everything from turn-2 onward.
  assert.deepEqual(visibleIds(db), [1, 2, 7, 8]);

  // turn-3 is in the log but off the visible path: it cannot be named.
  assert.throws(
    () => planConversationTurnDeletion({ conversation, clientMessageId: "turn-3" }, db),
    /no longer part of this chat/,
  );

  // Deleting the first turn leaves the visible tail exactly where it was.
  const plan = planConversationTurnDeletion(
    { conversation, clientMessageId: "turn-1" },
    db,
  );
  deleteConversationMessages(plan.messageIds, db);
  assert.deepEqual(visibleIds(db), [7, 8]);
  db.close();
});

test("a turn still being answered is refused rather than half-removed", () => {
  const db = seed([
    ...turn("turn-1", 1),
    { id: 3, clientMessageId: "turn-2", role: "user" },
    { id: 4, clientMessageId: "turn-2", role: "assistant", status: "pending" },
  ]);
  assert.throws(
    () => planConversationTurnDeletion({ conversation, clientMessageId: "turn-2" }, db),
    /Stop the response first/,
  );
  db.close();
});

test("an unknown message is a 404, not a silent no-op", () => {
  const db = seed([...turn("turn-1", 1)]);
  try {
    planConversationTurnDeletion({ conversation, clientMessageId: "nope" }, db);
    assert.fail("expected the plan to throw");
  } catch (error) {
    assert.equal(error.status, 404);
    assert.equal(error.code, "turn_not_found");
  }
  db.close();
});

test("the legacy mirror rows are removed, not just unpointed", () => {
  // chat_messages.canonical_message_id is ON DELETE SET NULL, so leaving this
  // to the foreign key would keep Garden's legacy copy of a deleted message.
  const db = seed([...turn("turn-1", 1), ...turn("turn-2", 3)]);
  db.prepare("INSERT INTO chat_messages (id, canonical_message_id) VALUES (1, 3)").run();
  db.prepare("INSERT INTO chat_messages (id, canonical_message_id) VALUES (2, 4)").run();
  db.prepare("INSERT INTO hermes_messages (id, canonical_message_id) VALUES (1, 4)").run();

  const plan = planConversationTurnDeletion(
    { conversation, clientMessageId: "turn-2" },
    db,
  );
  deleteConversationMessages(plan.messageIds, db);

  assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_messages").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hermes_messages").get().n, 0);
  db.close();
});

test("the route authorizes, stops the turn's work, and re-seeds the runtime", () => {
  assert.match(routeSource, /export async function DELETE/);
  assert.match(routeSource, /requireUserId/);
  assert.match(routeSource, /requireEnabled/);
  assert.match(routeSource, /getConversationForUser/);
  // A live run would answer a question that is being deleted underneath it.
  assert.match(routeSource, /run_already_active/);
  // An agent run outlives the row that names it, so it is stopped first.
  const deleteCall = routeSource.indexOf("deleteConversationMessages(plan.messageIds)");
  assert.ok(
    routeSource.indexOf("cancelExternalAgentRun(userId") < deleteCall,
    "agent runs must be stopped before their rows are deleted",
  );
  // The artifact pointer is nulled by the foreign key, so the ids have to be
  // read while the messages still exist.
  assert.ok(
    routeSource.indexOf("listArtifactIdsForMessages(plan.messageIds)") < deleteCall,
    "artifact ids must be read before the messages are deleted",
  );
  assert.match(routeSource, /deleteArtifact\(/);
  // The runtime holds its own copy of the conversation; without this it would
  // keep answering from a message the reader deleted.
  assert.match(routeSource, /forceRecreate: true/);
  assert.match(routeSource, /historyOverride: runtimeMessagesForBranch\(plan\.remaining\)/);
});

test("both chats offer the delete in the app's dialog and drop the branch with it", () => {
  for (const [name, source] of [
    ["terminal", panelSource],
    ["garden workspace", workspace],
  ]) {
    assert.match(source, /aria-label="Delete this message and its answer"/, name);
    assert.match(source, /function deleteMessageTurn/, name);
    assert.match(source, /confirmMessageDeletion\(\{/, name);
    assert.match(source, /title: "Delete this message\?"/, name);
    assert.match(source, /confirmLabel: "Delete message"/, name);
    assert.match(source, /\{messageDeleteDialog\}/, name);
    assert.doesNotMatch(
      source,
      /window\.confirm\(\s*"Delete this message/,
      `${name} still uses the desktop shell confirmation`,
    );
  }
  // The variants are snapshots of a transcript that no longer exists: left
  // behind, the switcher would offer to restore the deleted exchange.
  assert.match(panelSource, /delete next\[groupId\];/);
  assert.match(workspace, /delete next\[groupId\];/);
});

test("the session hook deletes the pair and forgets any stale history override", () => {
  assert.match(sessionHook, /deleteMessage: \(\s*message: AgentMessage,\s*messageIndex: number,?\s*\) => Promise<boolean>/);
  assert.match(
    sessionHook,
    /current\.filter\(\s*\(candidate\) => candidate\.clientMessageId !== target,?\s*\)/,
  );
  assert.match(sessionHook, /pendingHistoryOverrideRef\.current = null;/);
});
