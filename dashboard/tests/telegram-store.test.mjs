import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { TelegramStore, TelegramError } from "../src/lib/telegram/store.ts";
import {
  contactHandle,
  contactLabel,
  conversationTitleFor,
  formatAllowedUsers,
  normalizeTelegramIdentifier,
  parseAllowedUsers,
  senderIsAllowed,
} from "../src/lib/telegram/identity.ts";

function freshStore() {
  const db = new Database(":memory:");
  // Minimal shape of the two tables the Telegram schema references.
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER);
    INSERT INTO users (username) VALUES ('kuzey'), ('other');
    INSERT INTO conversations (user_id) VALUES (1), (1);
  `);
  return { db, store: new TelegramStore(db) };
}

test("usernames are case-folded and ids are left alone", () => {
  assert.equal(normalizeTelegramIdentifier("@Kuzey"), "kuzey");
  assert.equal(normalizeTelegramIdentifier(" KUZEY "), "kuzey");
  assert.equal(normalizeTelegramIdentifier(123456789), "123456789");
  // Group ids are negative; the sign is part of the id.
  assert.equal(normalizeTelegramIdentifier("-1001234567890"), "-1001234567890");
  assert.equal(normalizeTelegramIdentifier("*"), "*");
  assert.equal(normalizeTelegramIdentifier(null), "");
});

test("allowlists parse, dedupe, and round-trip", () => {
  assert.deepEqual(parseAllowedUsers("@Kuzey, 123456789\nkuzey"), ["kuzey", "123456789"]);
  assert.deepEqual(parseAllowedUsers("*"), ["*"]);
  assert.equal(formatAllowedUsers(["kuzey", "123456789"]), "kuzey,123456789");
});

test("a bot's @name is public, so an empty allowlist means nobody", () => {
  const sender = { senderId: "123456789", senderUsername: "Kuzey" };
  assert.equal(senderIsAllowed(sender, []), false);
  assert.equal(senderIsAllowed(sender, ["kuzey"]), true);
  assert.equal(senderIsAllowed(sender, ["123456789"]), true);
  assert.equal(senderIsAllowed(sender, ["someone-else"]), false);
  assert.equal(senderIsAllowed(sender, ["*"]), true);
  // An unknown sender with no username must not match on the empty string.
  assert.equal(senderIsAllowed({ senderId: "", senderUsername: "" }, [""]), false);
});

test("labels prefer a name, then a handle, then the id", () => {
  assert.equal(contactLabel({ senderName: "Kuzey", senderUsername: "kz", senderId: "1" }), "Kuzey");
  assert.equal(contactLabel({ senderName: "", senderUsername: "KZ", senderId: "1" }), "@kz");
  assert.equal(contactLabel({ senderName: "", senderUsername: "", senderId: "42" }), "Telegram 42");
  // A group is named by the group, not by whoever spoke.
  assert.equal(
    contactLabel({ isGroup: true, chatTitle: "Lab notes", senderName: "Kuzey" }),
    "Lab notes",
  );
  assert.equal(contactHandle({ senderUsername: "Kuzey", senderId: "1" }), "@kuzey");
  assert.equal(contactHandle({ senderUsername: "", senderId: "1" }), "1");
});

test("conversation titles carry the contact and the opening message", () => {
  assert.equal(
    conversationTitleFor("Kuzey", "what is on my calendar tomorrow?"),
    "Telegram · Kuzey: what is on my calendar tomorrow?",
  );
  assert.equal(conversationTitleFor("Kuzey", ""), "Telegram · Kuzey");
  assert.ok(conversationTitleFor("Kuzey", "x".repeat(500)).length <= 120);
});

test("the bot belongs to whoever linked it", () => {
  const { store } = freshStore();
  assert.equal(store.settings().ownerUserId, null);
  store.claimOwner(1);
  assert.equal(store.settings().ownerUserId, 1);
  assert.throws(() => store.requireOwner(2), TelegramError);
  assert.equal(store.requireOwner(1).ownerUserId, 1);
});

test("one sender can be admitted without rewriting the allowlist", () => {
  const { store } = freshStore();
  store.updateSettings({ allowedUsers: "@kuzey" });
  assert.deepEqual(store.allowSender("123456789").allowedUsers, ["kuzey", "123456789"]);
  // Admitting the same person twice is a no-op, not a duplicate.
  assert.deepEqual(store.allowSender("@Kuzey").allowedUsers, ["kuzey", "123456789"]);
  assert.throws(() => store.allowSender("  "), TelegramError);
});

test("the update offset only ever moves forward", () => {
  const { store } = freshStore();
  assert.equal(store.settings().lastUpdateId, 0);
  assert.equal(store.recordOffset(42), 42);
  // A late write from a poll that overlapped a restart must not replay messages.
  assert.equal(store.recordOffset(17), 42);
  assert.equal(store.recordOffset(43), 43);
  assert.equal(store.recordOffset("nonsense"), 43);
});

test("removing the bot forgets it, its offset, and the replay history", () => {
  const { store } = freshStore();
  store.claimOwner(1);
  store.recordBot({ id: "7", username: "breadboard_bot", name: "Breadboard" });
  store.recordOffset(99);
  assert.equal(store.claimMessage("m-1"), true);
  assert.equal(store.settings().botUsername, "breadboard_bot");

  store.clearBot();
  assert.equal(store.settings().botUsername, null);
  assert.equal(store.settings().linkedAt, null);
  assert.equal(store.settings().lastUpdateId, 0);
  assert.equal(store.claimMessage("m-1"), true);
});

test("a message id may only ever produce one turn", () => {
  const { store } = freshStore();
  assert.equal(store.claimMessage("55:1"), true);
  assert.equal(store.claimMessage("55:1"), false);
  assert.equal(store.claimMessage("55:2"), true);
});

test("chats map to conversations and list newest first", () => {
  const { store } = freshStore();
  store.claimOwner(1);
  store.upsertChat({
    chatId: "123456789",
    userId: 1,
    contactLabel: "Kuzey",
    contactHandle: "@kuzey",
    isGroup: false,
  });
  const bound = store.bindConversation("123456789", 1);
  assert.equal(bound.conversation_id, 1);
  assert.equal(bound.message_count, 1);

  store.upsertChat({
    chatId: "123456789",
    userId: 1,
    contactLabel: "Kuzey G",
    contactHandle: "@kuzey",
    isGroup: false,
  });
  const chats = store.listChats(1);
  assert.equal(chats.length, 1);
  assert.equal(chats[0].contact_label, "Kuzey G");
  assert.equal(chats[0].conversation_id, 1);
});

test("deleting a conversation drops the binding but keeps the contact", () => {
  const { db, store } = freshStore();
  db.pragma("foreign_keys = ON");
  store.claimOwner(1);
  store.upsertChat({
    chatId: "123456789",
    userId: 1,
    contactLabel: "Kuzey",
    contactHandle: "@kuzey",
    isGroup: false,
  });
  store.bindConversation("123456789", 2);
  db.prepare("DELETE FROM conversations WHERE id = 2").run();

  const chat = store.getChat("123456789");
  assert.notEqual(chat, null);
  assert.equal(chat.conversation_id, null);
});
