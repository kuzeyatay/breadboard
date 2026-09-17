import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { listPendingChatNotifications } from "../src/lib/chat-notifications/store.ts";
import { MessagingNotificationStore, formatMessagingNotification } from "../src/lib/messaging-notifications/store.ts";
import { TelegramStore } from "../src/lib/telegram/store.ts";
import { WhatsAppStore } from "../src/lib/whatsapp/store.ts";
import { recordQuestionNotification, resolveQuestionNotification } from "../src/lib/chat-notifications/questions.ts";

function fixture(t) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE clusters (id INTEGER PRIMARY KEY, user_id INTEGER, slug TEXT, name TEXT);
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, title TEXT, surface TEXT,
      default_garden_id INTEGER, legacy_chat_session_id INTEGER, temporary INTEGER DEFAULT 0, buzz_room_id INTEGER, origin_label TEXT
    );
    CREATE TABLE conversation_messages (
      id INTEGER PRIMARY KEY, conversation_id INTEGER, client_message_id TEXT, role TEXT DEFAULT 'assistant',
      content TEXT, status TEXT DEFAULT 'complete', metadata TEXT, updated_at TEXT
    );
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY, user_id INTEGER, conversation_id INTEGER);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER, status TEXT, dispatch_json TEXT, started_at TEXT, heartbeat_at TEXT);
    CREATE TABLE learn_jobs (
      id TEXT PRIMARY KEY, garden_id TEXT, status TEXT, current_step TEXT, progress_percent INTEGER DEFAULT 0,
      current_section_title TEXT, current_page_title TEXT, error TEXT, paused_from_status TEXT, updated_at TEXT
    );
    INSERT INTO users VALUES (1), (2);
    INSERT INTO clusters VALUES (1, 1, 'science', 'Science');
    INSERT INTO conversations (id, public_id, user_id, title, surface) VALUES
      (1, 'conv_one', 1, 'Research', 'dashboard_terminal'), (2, 'conv_two', 2, 'Other account', 'dashboard_terminal');
  `);
  const telegram = new TelegramStore(db);
  telegram.claimOwner(1);
  telegram.recordBot({ id: "bot1", username: "breadboard", name: "Breadboard" });
  telegram.updateSettings({ allowedUsers: "123,456" });
  for (const id of ["123", "456"]) telegram.upsertChat({ chatId: id, userId: 1, contactLabel: `Person ${id}`, contactHandle: id, isGroup: false });
  telegram.upsertChat({ chatId: "-100", userId: 1, contactLabel: "Group", contactHandle: "123", isGroup: true });
  const whatsapp = new WhatsAppStore(db);
  whatsapp.claimOwner(1);
  whatsapp.recordLink({ number: "31612345678", name: "Owner" });
  const store = new MessagingNotificationStore(db);
  const answer = (id, options = {}) => db.prepare(`INSERT INTO conversation_messages
    (id, conversation_id, client_message_id, content, metadata, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, options.user ?? 1, options.clientId ?? null, options.text ?? "The answer is ready.", options.metadata ? JSON.stringify(options.metadata) : null,
      options.status ?? "complete", options.time ?? "2099-01-01 00:00:00");
  const enable = (channel = "telegram", recipient = "123") => store.update(1, channel, { enabled: true, recipient });
  return { db, store, telegram, whatsapp, answer, enable };
}

test("channels default off and expose only private, account-owned recipients", t => {
  const { store } = fixture(t);
  assert.equal(store.settings(1, "telegram").enabled, false);
  assert.deepEqual(store.settings(1, "telegram").recipients.map(item => item.id).sort(), ["123", "456"]);
  assert.equal(store.settings(1, "whatsapp").recipients[0].id, "31612345678@s.whatsapp.net");
  assert.deepEqual(store.settings(2, "telegram").recipients, []);
  assert.deepEqual(store.settings(2, "whatsapp").recipients, []);
  assert.throws(() => store.update(2, "telegram", { enabled: true, recipient: "123" }), /private chat/);
  for (const recipient of ["-100", "*", "999"]) assert.throws(() => store.update(1, "telegram", { enabled: true, recipient }), /private chat/);
  assert.throws(() => store.update(1, "telegram", { enabled: "true", recipient: "123" }), /switch/);
});

test("enabled channels deliver a new question once and skip questions already answered", async t => {
  const { db, store, enable } = fixture(t);
  enable();
  const now = new Date().toISOString();
  db.exec('INSERT INTO hermes_runtime_sessions VALUES(1,1,1)');
  db.prepare('INSERT INTO hermes_runs VALUES(1,1,\'active\',\'{}\',?,?)').run(now,now);
  const ask = requestId => recordQuestionNotification(db,{ runtimeSessionId:1, runId:'1', requestId,
    question:'Which year should I use?', choices:[] });
  ask('pending');
  const sent = [];
  await store.deliver(1,'telegram',async (recipient,text) => sent.push({recipient,text}));
  assert.equal(sent.length,1);
  assert.equal(sent[0].recipient,'123');
  assert.match(sent[0].text,/Answer needed\n\nResearch\n\nWhich year should I use\?/);
  ask('pending');
  await store.deliver(1,'telegram',async () => assert.fail('duplicate question'));
  ask('answered');
  resolveQuestionNotification(db,1,'answered');
  await store.deliver(1,'telegram',async () => assert.fail('already answered'));
});

test("saving recipients while off never sends, and settings survive a new store instance", async t => {
  const { db, store, answer } = fixture(t);
  store.update(1, "telegram", { enabled: false, recipient: "123" });
  answer(1);
  await store.deliver(1, "telegram", async () => assert.fail("disabled"));
  assert.equal(new MessagingNotificationStore(db).settings(1, "telegram").recipient, "123");
});

test("each enabled channel sends new notifications once without replaying history or other accounts", async t => {
  const { db, store, answer, enable } = fixture(t);
  answer(1, { time: "2000-01-01 00:00:00", text: "Old answer" });
  enable();
  enable("whatsapp", "31612345678@s.whatsapp.net");
  answer(2);
  answer(3, { user: 2, text: "Private foreign answer" });
  answer(4, { clientId: "telegram-message", text: "Already sent via Telegram" });
  answer(5, { metadata: { deliveryChannel: "whatsapp" }, text: "Already sent via WhatsApp" });
  const sent = [];
  for (const channel of ["telegram", "whatsapp"]) {
    await store.deliver(1, channel, async (recipient, text) => sent.push({ channel, recipient, text }));
    await new MessagingNotificationStore(db).deliver(1, channel, async () => assert.fail("duplicate"));
  }
  assert.equal(sent.length, 2);
  assert.equal(sent[0].recipient, "123");
  assert.equal(sent[1].recipient, "31612345678@s.whatsapp.net");
  assert.match(sent[0].text, /Response ready\n\nResearch\n\nThe answer is ready/);
});

test("concurrent workers claim one delivery and disabling cancels the remainder of a batch", async t => {
  const { db, store, answer, enable } = fixture(t);
  enable();
  answer(1);
  answer(2);
  let finish;
  let count = 0;
  const first = store.deliver(1, "telegram", async () => { count++; await new Promise(resolve => { finish = resolve; }); });
  // A second worker cannot send the first notice; it can claim independent work.
  await new MessagingNotificationStore(db).deliver(1, "telegram", async () => { count++; });
  store.update(1, "telegram", { enabled: false });
  finish();
  await first;
  assert.equal(count, 2);
  answer(3);
  await store.deliver(1, "telegram", async () => assert.fail("disabled"));
});

test("turning off during a send stops further sends and re-enabling skips the disabled interval", async t => {
  const { store, answer, enable } = fixture(t);
  enable();
  answer(1);
  answer(2);
  let count = 0;
  await store.deliver(1, "telegram", async () => { count++; store.update(1, "telegram", { enabled: false }); });
  assert.equal(count, 1);
  answer(3);
  enable();
  await store.deliver(1, "telegram", async () => assert.fail("disabled backlog"));
  answer(4);
  await store.deliver(1, "telegram", async () => { count++; });
  assert.equal(count, 2);
});

test("recipient changes, removed permissions and relinking cannot redirect a pending delivery", async t => {
  const { store, telegram, answer, enable } = fixture(t);
  enable();
  answer(1);
  enable("telegram", "456");
  await store.deliver(1, "telegram", async () => assert.fail("old recipient backlog"));
  answer(2);
  telegram.updateSettings({ allowedUsers: "123" });
  await store.deliver(1, "telegram", async () => assert.fail("removed permission"));
  assert.match(store.settings(1, "telegram").lastError, /Choose your chat/);
  telegram.updateSettings({ allowedUsers: "123,456" });
  telegram.recordBot({ id: "another-bot", username: "other", name: "Other" });
  await store.deliver(1, "telegram", async () => assert.fail("different bot"));
});

test("revoking a recipient between sends stops the current batch", async t => {
  const { store, telegram, answer, enable } = fixture(t);
  enable();
  answer(1);
  answer(2);
  let count = 0;
  await store.deliver(1, "telegram", async () => {
    count++;
    telegram.updateSettings({ allowedUsers: "456" });
  });
  assert.equal(count, 1);
});

test("delivery failures are sanitized and retries back off and stop after three attempts", async t => {
  const { db, store, answer, enable } = fixture(t);
  enable();
  answer(1);
  let attempts = 0;
  const fail = async () => { attempts++; throw new Error("https://secret-token.example/private-recipient"); };
  await store.deliver(1, "telegram", fail);
  assert.equal(attempts, 1);
  assert.doesNotMatch(store.settings(1, "telegram").lastError, /secret-token|private-recipient/);
  await store.deliver(1, "telegram", fail);
  assert.equal(attempts, 1);
  for (let i = 0; i < 5; i++) {
    db.prepare("UPDATE messaging_notification_deliveries SET retry_at = 0").run();
    await store.deliver(1, "telegram", fail);
  }
  assert.equal(attempts, 3);
});

test("a retry can succeed, clears its error, and records the delivery time", async t => {
  const { db, store, answer, enable } = fixture(t);
  enable();
  answer(1, { status: "failed", text: "The task failed." });
  await store.deliver(1, "telegram", async () => { throw new Error("offline"); });
  db.prepare("UPDATE messaging_notification_deliveries SET retry_at = 0").run();
  await store.deliver(1, "telegram", async (_, text) => assert.match(text, /Response failed/));
  assert.equal(store.settings(1, "telegram").lastError, null);
  assert.ok(store.settings(1, "telegram").lastSentAt);
});

test("Learn progress sends once per phase and completion gets a new notification", async t => {
  const { db, store, enable } = fixture(t);
  enable();
  db.prepare("INSERT INTO learn_jobs (id, garden_id, status, updated_at) VALUES ('learn1', 'science', 'planning', '2099-01-01T00:00:00Z')").run();
  const sent = [];
  const send = async (_, text) => sent.push(text);
  await store.deliver(1, "telegram", send);
  db.prepare("UPDATE learn_jobs SET progress_percent = 50, updated_at = '2099-01-01T01:00:00Z'").run();
  await store.deliver(1, "telegram", send);
  db.prepare("UPDATE learn_jobs SET status = 'complete', updated_at = '2099-01-01T02:00:00Z'").run();
  await store.deliver(1, "telegram", send);
  assert.equal(sent.length, 2);
  assert.match(sent[0], /Learn in progress/);
  assert.match(sent[1], /Learn complete/);
});

test("a reconciled selected-text answer keeps its delivered identity", async t => {
  const { store, answer, enable } = fixture(t);
  enable();
  answer(1, { metadata: { inlineSelection: { requestId: "selection1" } } });
  await store.deliver(1, "telegram", async () => {});
  answer(2, { metadata: { toolCalls: { inlineSelection: { requestId: "selection1" } } } });
  await store.deliver(1, "telegram", async () => assert.fail("reconciled duplicate"));
});

test("long notifications fit in one provider message", () => {
  const formatted = formatMessagingNotification({ title: "Response ready", chatTitle: "Long answer", response: "x".repeat(10_000) });
  assert.equal(formatted.length, 3_500);
  assert.ok(formatted.endsWith("…"));
});


test("delivered phone reminders and review answers cannot be forwarded back to the phone", async t => {
  const { db, store, answer, enable } = fixture(t);
  enable();
  enable("whatsapp", "31612345678@s.whatsapp.net");
  let id = 0;
  for (const channel of ["telegram", "whatsapp"]) {
    for (const direction of ["outbound", "inbound"]) {
      answer(++id, { metadata: { externalMessaging: true, externalMessagingChannel: channel,
        externalMessagingDirection: direction, externalMessagingKind: "reminder" } });
    }
  }
  const sent = [];
  for (const channel of ["telegram", "whatsapp"]) {
    await store.deliver(1, channel, async (_, text) => { sent.push(text); });
  }
  assert.deepEqual(sent, [], "phone transcripts must not be forwarded again");
  assert.equal(listPendingChatNotifications(db, 1).length, 4, "local reminders remain available for voice and replies");
  answer(++id);
  await store.deliver(1, "telegram", async () => {});
  assert.ok(store.settings(1, "telegram").lastSentAt);
});
