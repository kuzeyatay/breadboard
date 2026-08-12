import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { WhatsAppStore, WhatsAppError } from "../src/lib/whatsapp/store.ts";
import {
  contactLabel,
  conversationTitleFor,
  formatAllowedNumbers,
  normalizeWhatsAppIdentifier,
  parseAllowedNumbers,
  senderIsAllowed,
} from "../src/lib/whatsapp/identity.ts";

function freshStore() {
  const db = new Database(":memory:");
  // Minimal shape of the two tables the WhatsApp schema references.
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER);
    INSERT INTO users (username) VALUES ('kuzey'), ('other');
    INSERT INTO conversations (user_id) VALUES (1), (1);
  `);
  return { db, store: new WhatsAppStore(db) };
}

test("identifiers normalize the way the Hermes bridge normalizes them", () => {
  assert.equal(normalizeWhatsAppIdentifier("31612345678@s.whatsapp.net"), "31612345678");
  assert.equal(normalizeWhatsAppIdentifier("31612345678:12@s.whatsapp.net"), "31612345678");
  assert.equal(normalizeWhatsAppIdentifier("67427329167522@lid"), "67427329167522");
  assert.equal(normalizeWhatsAppIdentifier(" +31 (6) 1234-5678 "), "31612345678");
  assert.equal(normalizeWhatsAppIdentifier(null), "");
});

test("allowlists parse, dedupe, and round-trip to the bridge's env format", () => {
  assert.deepEqual(parseAllowedNumbers("+31612345678, 15551234567\n31612345678"), [
    "31612345678",
    "15551234567",
  ]);
  assert.deepEqual(parseAllowedNumbers("*"), ["*"]);
  assert.equal(formatAllowedNumbers(["31612345678", "15551234567"]), "31612345678,15551234567");
});

test("senders are gated in bot mode and unrestricted in self-chat", () => {
  assert.equal(senderIsAllowed("31612345678@s.whatsapp.net", ["31612345678"], "bot"), true);
  assert.equal(senderIsAllowed("99999999999@s.whatsapp.net", ["31612345678"], "bot"), false);
  assert.equal(senderIsAllowed("99999999999@s.whatsapp.net", [], "bot"), false);
  assert.equal(senderIsAllowed("99999999999@s.whatsapp.net", ["*"], "bot"), true);
  // Self-chat only ever carries the linked account's own messages.
  assert.equal(senderIsAllowed("anything", [], "self-chat"), true);
});

test("a bare number is not treated as a contact name", () => {
  assert.equal(
    contactLabel({ senderName: "31612345678", senderId: "31612345678@s.whatsapp.net" }),
    "+31612345678",
  );
  assert.equal(contactLabel({ senderName: "Kuzey", senderId: "31612345678@s.whatsapp.net" }), "Kuzey");
});

test("conversation titles carry the contact and the opening message", () => {
  assert.equal(
    conversationTitleFor("Kuzey", "what is on my calendar tomorrow?"),
    "WhatsApp · Kuzey: what is on my calendar tomorrow?",
  );
  assert.equal(conversationTitleFor("Kuzey", ""), "WhatsApp · Kuzey");
  assert.ok(conversationTitleFor("Kuzey", "x".repeat(500)).length <= 120);
});

test("the linked device belongs to whoever paired it", () => {
  const { store } = freshStore();
  assert.equal(store.settings().ownerUserId, null);
  store.claimOwner(1);
  assert.equal(store.settings().ownerUserId, 1);
  // A second Breadboard account cannot take over or read the link.
  assert.throws(() => store.requireOwner(2), WhatsAppError);
  assert.equal(store.requireOwner(1).ownerUserId, 1);
});

test("bot mode refuses an empty allowlist", () => {
  const { store } = freshStore();
  assert.throws(() => store.updateSettings({ mode: "bot" }), /at least one allowed number/);
  const saved = store.updateSettings({ mode: "bot", allowedNumbers: "+31612345678" });
  assert.equal(saved.mode, "bot");
  assert.deepEqual(saved.allowedNumbers, ["31612345678"]);
});

test("unlinking forgets the device and the redelivery history", () => {
  const { store } = freshStore();
  store.claimOwner(1);
  store.recordLink({ number: "31612345678", name: "Kuzey" });
  assert.equal(store.settings().linkedNumber, "31612345678");
  assert.equal(store.claimMessage("abc"), true);

  store.clearLink();
  assert.equal(store.settings().linkedNumber, null);
  assert.equal(store.settings().linkedAt, null);
  // The dedupe table was cleared with the link, so ids may be reused.
  assert.equal(store.claimMessage("abc"), true);
});

test("a message id may only ever produce one turn", () => {
  const { store } = freshStore();
  assert.equal(store.claimMessage("msg-1"), true);
  assert.equal(store.claimMessage("msg-1"), false);
  assert.equal(store.claimMessage("msg-2"), true);
});

test("chats map to conversations and list newest first", () => {
  const { store } = freshStore();
  store.claimOwner(1);
  store.upsertChat({
    chatId: "31612345678@s.whatsapp.net",
    userId: 1,
    contactLabel: "Kuzey",
    contactNumber: "31612345678",
    isGroup: false,
  });
  const bound = store.bindConversation("31612345678@s.whatsapp.net", 1);
  assert.equal(bound.conversation_id, 1);
  assert.equal(bound.message_count, 1);

  // Re-seeing the chat updates the contact without losing the binding.
  store.upsertChat({
    chatId: "31612345678@s.whatsapp.net",
    userId: 1,
    contactLabel: "Kuzey G",
    contactNumber: "31612345678",
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
    chatId: "31612345678@s.whatsapp.net",
    userId: 1,
    contactLabel: "Kuzey",
    contactNumber: "31612345678",
    isGroup: false,
  });
  store.bindConversation("31612345678@s.whatsapp.net", 2);
  db.prepare("DELETE FROM conversations WHERE id = 2").run();

  const chat = store.getChat("31612345678@s.whatsapp.net");
  assert.notEqual(chat, null);
  assert.equal(chat.conversation_id, null);
});
