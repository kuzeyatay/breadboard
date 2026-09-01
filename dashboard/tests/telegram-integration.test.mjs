import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { splitForTelegram, TELEGRAM_MESSAGE_LIMIT } from "../src/lib/telegram/client.ts";
import { normalizeInbound } from "../src/lib/telegram/gateway.ts";
import {
  conversationIsWarm,
  messageText,
  HELP_TEXT,
} from "../src/lib/telegram/inbound-policy.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const client = source("../src/lib/telegram/client.ts");
const gateway = source("../src/lib/telegram/gateway.ts");
const inbound = source("../src/lib/telegram/inbound.ts");
const service = source("../src/lib/telegram/service.ts");
const status = source("../src/lib/telegram/status.ts");
const credentials = source("../src/lib/telegram/credentials.ts");
const gatewayService = source("../scripts/runtime-v2-telegram-gateway-service.mjs");
const panel = source("../src/app/components/settings-telegram.tsx");
const messaging = source("../src/app/components/settings-messaging.tsx");
const connectionRoute = source("../src/app/api/telegram/connection/route.ts");
const statusRoute = source("../src/app/api/telegram/route.ts");
const db = source("../src/lib/db.ts");

test("an update flattens into the shape the rest of Breadboard reads", () => {
  const message = normalizeInbound({
    update_id: 100,
    message: {
      message_id: 7,
      date: 1_800_000_000,
      text: "hello",
      from: { id: 123456789, username: "Kuzey", first_name: "Kuzey", last_name: "G" },
      chat: { id: 123456789, type: "private" },
    },
  });
  assert.equal(message.messageId, "123456789:7");
  assert.equal(message.updateId, 100);
  assert.equal(message.senderUsername, "Kuzey");
  assert.equal(message.senderName, "Kuzey G");
  assert.equal(message.isGroup, false);
  assert.equal(message.hasMedia, false);
  assert.equal(message.body, "hello");

  // Updates there is nothing to answer must not consume a turn.
  assert.equal(normalizeInbound({ update_id: 1 }), null);
  assert.equal(normalizeInbound({ message: { chat: { id: 1 }, text: "" } }), null);
  assert.equal(
    normalizeInbound({ message: { chat: { id: 1 }, text: "hi", from: { id: 2, is_bot: true } } }),
    null,
  );
});

test("a photo with a caption arrives as media, not as an empty message", () => {
  const message = normalizeInbound({
    update_id: 2,
    message: {
      message_id: 8,
      caption: "what does this say?",
      photo: [{ file_id: "abc" }],
      from: { id: 1 },
      chat: { id: -100123, type: "supergroup", title: "Lab notes" },
    },
  });
  assert.equal(message.body, "what does this say?");
  assert.equal(message.hasMedia, true);
  assert.equal(message.mediaType, "photo");
  assert.equal(message.isGroup, true);
  assert.equal(message.chatTitle, "Lab notes");
});

test("a message goes through the same authenticated turn pipeline as the browser", () => {
  assert.match(inbound, /createConversation\(/);
  assert.match(inbound, /startConversationTurn\(/);
  assert.match(inbound, /resolveConversationRuntime\(/);
  // The chat must be a Terminal chat, which is what makes it show up in the
  // desktop app's Recents rather than living only inside Telegram.
  assert.match(inbound, /surface: "dashboard_terminal"/);
  // The pump is attached before dispatch, exactly like the browser does.
  assert.ok(
    inbound.indexOf("startSessionEventPump") < inbound.indexOf("startConversationTurn("),
    "the event pump must be started before the turn is dispatched",
  );
  // An unattended message must never sit waiting on a permission prompt.
  assert.match(inbound, /"blocked" in result/);
  assert.match(inbound, /surfaceContext: \{ deliveryChannel: "telegram" \}/);
  // Telegram has no composer switch, so its default must be explicit rather
  // than inheriting the ordinary-agent default from the shared turn service.
  assert.match(inbound, /superAgent: true/);
  // And the runtime is checked before anything is created.
  assert.ok(
    inbound.indexOf("requireEnabled()") < inbound.indexOf("createConversation("),
    "a stopped runtime must not leave an empty chat behind",
  );
});

test("Telegram reminders are scheduled before the agent and retain Telegram provenance", () => {
  assert.match(inbound, /parseExplicitScheduleRequest\(text, now\)/);
  assert.match(inbound, /deliveryChannel: "telegram"/);
  assert.match(inbound, /deliveryMode: "reminder"/);
  assert.match(inbound, /`Telegram:\$\{initialSummary\}`/);
  assert.ok(
    inbound.indexOf("if (scheduledReminder)") < inbound.indexOf("resolveConversationRuntime({"),
    "a recognized reminder must not enter the agent runtime",
  );
  assert.match(inbound, /scheduledChatConfirmationText\(receipt\)/);
  assert.match(inbound, /completeAssistantMessage\(\{/);
});

test("an inbound message wakes the on-demand runtime, and a failed turn strands no empty chat", () => {
  // The gateway process holds no supervisor control, so the on-demand Hermes
  // service must be woken (via the dashboard) before the turn — and before any
  // conversation exists, so a runtime that cannot come back fails cleanly.
  assert.match(inbound, /wakeAgentRuntime\("telegram-inbound"\)/);
  assert.ok(
    inbound.indexOf("wakeAgentRuntime(") < inbound.indexOf("createConversation("),
    "the runtime must be woken before a conversation is created",
  );
  // If the turn still dies before persisting anything, the fresh conversation
  // is removed rather than left as an empty chat in Recents.
  assert.match(inbound, /deleteConversation\(createdConversation\)/);
});

test("only the owner's allowed senders can spend tokens", () => {
  assert.match(inbound, /settings\.ownerUserId === null/);
  assert.match(inbound, /senderIsAllowed\(message, settings\.allowedUsers\)/);
  // Routes refuse anyone who is not the owner of the linked bot.
  assert.match(connectionRoute, /store\.requireOwner\(userId\)/);
  assert.match(statusRoute, /store\.requireOwner\(userId\)/);
  // A stranger gets silence, not a reply that confirms the bot is live.
  assert.match(inbound, /status: "ignored", reason: "not_allowed"/);
});

test("a replayed update never produces a second turn or a second reply", () => {
  assert.match(service, /claimMessage\(message\.messageId\)/);
  // Per-chat serialization: a burst cannot open two turns on one conversation.
  assert.match(service, /function serialize\(/);
  assert.match(service, /serialize\(message\.chatId, \(\) => handleMessage\(message\)\)/);
  // Telegram replays everything until it is acknowledged by offset, so the
  // offset has to be persisted as it advances rather than at shutdown.
  assert.match(service, /onOffset: \(offset\) => \{/);
  assert.match(service, /settings\.recordOffset\(offset\)/);
  assert.match(gateway, /this\.onOffset\?\.\(this\.offset\)/);
});

test("the gateway loop lives in the native-owned Runtime service", () => {
  assert.match(gatewayService, /startRuntimeV2GatewayHttpService/);
  assert.match(gatewayService, /BREADBOARD_TELEGRAM_GATEWAY_TOKEN/);
  assert.match(connectionRoute, /reconcileRuntimeGateway\("telegram", "running", userId\)/);
  assert.match(service, /__breadboardTelegramPolling/);
  assert.match(service, /timer\.unref\(\)/);
  // Autostart must not be able to break server startup: the conversation stack is
  // only imported when a message actually needs it, never at boot.
  assert.match(service, /await import\("\.\/inbound\.ts"\)/);
  assert.match(service, /await import\("\.\/instance\.ts"\)/);
  assert.doesNotMatch(service, /^import .*from "\.\/inbound\.ts"/m);
  assert.doesNotMatch(service, /^import .*from "\.\/instance\.ts"/m);
  assert.doesNotMatch(statusRoute, /telegram\/service|telegram\/gateway/);
});

test("a hopeless failure stops the poll instead of hammering Telegram", () => {
  // A rejected token and a stolen update stream can never recover by retrying.
  assert.match(gateway, /apiError\?\.isAuthFailure/);
  assert.match(gateway, /apiError\?\.isConflict/);
  // A webhook makes long polling impossible; clearing it is what turns an
  // unexplained 409 loop into a connection.
  assert.match(gateway, /deleteWebhook\(/);
  // Transient failures back off rather than spinning — and the backoff is
  // abortable, so Disconnect never waits it out.
  assert.match(gateway, /failures \+= 1/);
  assert.match(gateway, /await delay\(Math\.min\(retryDelayMs/);
  assert.match(gateway, /signal\.addEventListener\("abort", onAbort/);
});

test("the bot token never reaches the browser", () => {
  // It is written to disk, not to SQLite, and the status payload carries only
  // whether one exists and which bot it resolved to.
  assert.match(credentials, /telegramTokenFile\(\)/);
  assert.match(credentials, /mode: 0o600/);
  assert.doesNotMatch(status, /\btoken:/);
  assert.match(status, /linked: hasBotToken\(\)/);
  // And the panel only ever sends one upward.
  assert.doesNotMatch(panel, /status\.token\b/);
  assert.match(panel, /type="password"/);
  // The token is part of every Bot API URL, so no URL may reach an error.
  assert.doesNotMatch(client, /\$\{url\}|url: `/);
});

test("replies are split to Telegram's limit rather than truncated", () => {
  const long = Array.from({ length: 1_000 }, (_, index) => `line ${index}`).join("\n");
  assert.ok(long.length > TELEGRAM_MESSAGE_LIMIT);
  const chunks = splitForTelegram(long);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= TELEGRAM_MESSAGE_LIMIT);
  // Nothing is dropped on the way through the splitter.
  assert.equal(chunks.join("\n"), long);

  // A word longer than the limit still has to go somewhere.
  const unbroken = "x".repeat(TELEGRAM_MESSAGE_LIMIT * 2 + 5);
  const split = splitForTelegram(unbroken);
  assert.equal(split.length, 3);
  assert.deepEqual(splitForTelegram("   "), []);
});

test("chats reuse a warm thread and open a new one after a quiet spell", () => {
  const now = new Date("2026-07-30T12:00:00Z");
  const ago = (minutes) =>
    new Date(now.getTime() - minutes * 60_000).toISOString().replace("T", " ").slice(0, 19);
  assert.equal(conversationIsWarm(ago(5), now), true);
  assert.equal(conversationIsWarm(ago(60), now), true);
  // Default window is 6 hours.
  assert.equal(conversationIsWarm(ago(7 * 60), now), false);
  assert.equal(conversationIsWarm("not a date", now), false);
});

test("media is described rather than silently dropped", () => {
  const withCaption = messageText({
    body: "what does this say?",
    hasMedia: true,
    mediaType: "photo",
    fileName: "",
  });
  assert.match(withCaption, /what does this say\?/);
  assert.match(withCaption, /cannot open Telegram attachments yet/);
  assert.equal(messageText({ body: " hi ", hasMedia: false }), "hi");
});

test("/help and /start answer without opening a chat, even in a group", () => {
  assert.match(HELP_TEXT, /\/new/);
  assert.match(inbound, /command === "\/help" \|\| command === "\/start"/);
  assert.match(inbound, /const forceNew = command === "\/new"/);
  // Telegram appends @botname to commands sent in groups.
  assert.match(inbound, /replace\(\/@\[\\w_\]\+\$\/, ""\)/);
});

test("a sender the allowlist turned away can be admitted in one click", () => {
  assert.match(service, /gateway\.noteBlockedSender\(message\)/);
  assert.match(gateway, /noteBlockedSender\(message: TelegramInboundMessage\)/);
  assert.match(connectionRoute, /store\.allowSender\(senderId\)/);
  // The long-lived Runtime service owns the blocked-sender snapshot, so it is
  // the process that must clear the entry after the route forwards `allow`.
  assert.match(gatewayService, /gateway\.clearBlockedSender\(body\.value\)/);
  assert.match(connectionRoute, /action: "allow",\s*\n\s*value: senderId/);
  assert.match(panel, /action: "allow", senderId:/);
});

test("Telegram sits beside WhatsApp in Settings → Messaging", () => {
  assert.match(messaging, /import SettingsTelegram, \{ PaperPlaneIcon, useTelegramStatus \}/);
  assert.match(messaging, /<SettingsTelegram status=\{telegram\.status\} refresh=\{telegram\.refresh\} \/>/);
  // Line art in Breadboard's own weight, not Telegram's brand disc.
  assert.match(panel, /stroke="currentColor"/);
  assert.doesNotMatch(panel, /#2AABEE|#229ED9/);
  // The panel says what the integration actually is and what it cannot see.
  assert.match(panel, /official Bot API/);
  assert.match(panel, /privacy mode/);
  assert.match(panel, /@BotFather/);
  assert.match(panel, /placeholder="@username, 123456789"/);
  assert.doesNotMatch(panel, /@kuzey/i);
});

test("the Telegram tables are created with the rest of the schema", () => {
  assert.match(db, /ensureTelegramSchema\(db\)/);
  assert.ok(
    db.indexOf("ensureConversationSchema(db)") < db.indexOf("ensureTelegramSchema(db)"),
    "telegram_chats references conversations, so that table must exist first",
  );
});
