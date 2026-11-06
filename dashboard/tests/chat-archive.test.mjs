import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-archive-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const { ensureConversationSchema } = await import("../src/lib/conversations/schema.ts");

after(() => { db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });
beforeEach(() => {
  db.exec(`DELETE FROM conversations; DELETE FROM chat_sessions; DELETE FROM clusters; DELETE FROM users;
    INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x'), (2, 'bob', 'bob@example.test', 'x');
    INSERT INTO clusters(id, user_id, name, slug) VALUES (10, 1, 'Garden', 'garden'), (11, 1, 'Other', 'other');`);
});

test("archive and restore preserve the transcript, pin, highlight and activity timestamp", () => {
  let chat = store.createConversation({ userId: 1, title: "Keep this chat" });
  chat = store.setConversationPinned(chat, true);
  chat = store.setConversationHighlight(chat, "sage");
  db.prepare(`INSERT INTO conversation_messages(conversation_id, client_message_id, role, surface, content, status, order_index)
    VALUES (?, 'message', 'user', 'dashboard_terminal', 'Keep this message', 'complete', 0)`).run(chat.id);
  const before = store.listConversationMessages(chat.id);
  const archived = store.setConversationArchived(chat, true);
  assert.equal(store.presentConversation(archived).archived, true);
  assert.equal(archived.updated_at, chat.updated_at);
  assert.equal(archived.pinned_at, chat.pinned_at);
  assert.equal(archived.highlight, chat.highlight);
  assert.deepEqual(store.listConversationsForUser(1), []);
  assert.equal(store.listArchivedConversationsForUser(1)[0].id, chat.id);
  assert.deepEqual(store.listConversationMessages(chat.id), before);
  assert.equal(store.getConversationForUser(chat.public_id, 1).id, chat.id);
  ensureConversationSchema(db);
  assert.equal(store.getConversationById(chat.id).archived_at, archived.archived_at, "migration preserves archived state");
  const restored = store.setConversationArchived(archived, false);
  assert.equal(restored.archived_at, null);
  assert.equal(store.listConversationsForUser(1)[0].id, chat.id);
  assert.deepEqual(store.listArchivedConversationsForUser(1), []);
  assert.deepEqual(store.listConversationMessages(chat.id), before);
});

test("archives are scoped to their owner and garden and exclude temporary chats", () => {
  const garden = store.createConversation({ userId: 1, title: "Garden chat", surface: "garden_chat", defaultGardenId: 10, linkToGardenWorkspace: true });
  const other = store.createConversation({ userId: 1, surface: "garden_chat", defaultGardenId: 11, linkToGardenWorkspace: true });
  const foreign = store.createConversation({ userId: 2 });
  const temporary = store.createConversation({ userId: 1, temporary: true });
  for (const chat of [garden, other, foreign, temporary]) store.setConversationArchived(chat, true);
  assert.deepEqual(store.listArchivedConversationsForUser(1, "garden").map(chat => chat.id), [garden.id]);
  assert.deepEqual(new Set(store.listArchivedConversationsForUser(1).map(chat => chat.id)), new Set([garden.id, other.id]));
  assert.throws(() => store.getConversationForUser(garden.public_id, 2));
  assert.ok(garden.legacy_chat_session_id > 0);
  assert.equal(store.ensureConversationForLegacyChatSession(garden.legacy_chat_session_id, 1).archived_at, store.getConversationById(garden.id).archived_at);
});

test("archived chats do not crowd out active history and older archives remain accessible", () => {
  const active = store.createConversation({ userId: 1, title: "Active" });
  for (let index = 0; index < 105; index++) {
    const chat = store.createConversation({ userId: 1, title: `Archived ${index}` });
    store.setConversationArchived(chat, true);
  }
  assert.deepEqual(store.listConversationsForUser(1).map(chat => chat.id), [active.id]);
  assert.equal(store.listArchivedConversationsForUser(1).length, 105);
});
