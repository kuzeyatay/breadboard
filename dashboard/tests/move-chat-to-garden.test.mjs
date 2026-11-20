import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-move-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const { conversationOriginLabel } = await import("../src/lib/conversations/origin-label.ts");

after(() => { db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

test("a terminal chat moved to a garden becomes a workspace chat with its transcript", () => {
  db.exec(`INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x');
    INSERT INTO clusters(id, user_id, name, slug) VALUES (10, 1, 'EC 2', 'ec-2');`);
  const chat = store.createConversation({ userId: 1, title: "Phase margin" });
  db.prepare(`INSERT INTO conversation_messages(conversation_id, client_message_id, role, surface, content, status, order_index)
    VALUES (?, 'turn-0001', 'user', 'dashboard_terminal', 'Question', 'complete', 0),
           (?, 'turn-0001', 'assistant', 'dashboard_terminal', 'Answer', 'complete', 1)`).run(chat.id, chat.id);

  const moved = store.moveConversationToGarden(chat, 10);
  assert.equal(moved.surface, "garden_chat");
  assert.equal(moved.default_garden_id, 10);
  const session = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(moved.legacy_chat_session_id);
  assert.equal(session.cluster_id, 10);
  assert.equal(session.conversation_id, chat.id);
  assert.deepEqual(
    db.prepare("SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY order_index").all(session.id).map((r) => ({ ...r })),
    [{ role: "user", content: "Question" }, { role: "assistant", content: "Answer" }],
  );
  // The workspace adapter accepts it as its own.
  assert.equal(store.ensureConversationForLegacyChatSession(session.id, 1).id, chat.id);
  assert.equal(
    conversationOriginLabel({ surface: moved.surface, gardenName: "EC 2", historySurface: session.history_surface }),
    "EC 2: Workspace",
  );
  assert.throws(() => store.moveConversationToGarden(moved, 10), /Only terminal chats/);
});
