import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  explainSelfTargetFailure,
  resolveTelegramSelfTarget,
  resolveWhatsAppSelfTarget,
} from "../src/lib/messaging/self-target.ts";
import { messagingCommandText } from "../src/lib/hermes/messaging-intent.ts";
import { normalizeWhatsAppIdentifier } from "../src/lib/whatsapp/identity.ts";
import {
  allowedToolsForSurface,
  MESSAGING_TOOLS,
} from "../src/lib/hermes/tool-scopes.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const service = source("../src/lib/hermes/messaging-service.ts");
const route = source("../src/app/api/hermes/tools/messaging/route.ts");
const broker = source("../src/lib/hermes/capability-broker.ts");
const turnService = source("../src/lib/conversations/turn-service.ts");
const gardenAdapter = source("../src/lib/hermes/garden-chat-adapter.ts");
const skill = source("../../hermes-skills/prebuilt/send-to-my-phone/SKILL.md");
const pluginManifest = source("../../hermes-agent/plugins/breadboard/plugin.yaml");
const pluginModule = source("../../hermes-agent/plugins/breadboard/__init__.py");
const telegramClient = source("../src/lib/telegram/client.ts");
const whatsAppBridge = source("../src/lib/whatsapp/bridge.ts");

const chat = (over = {}) => ({
  chat_id: "31600000000@s.whatsapp.net",
  contact_number: "31600000000",
  contact_label: "Me",
  is_group: 0,
  last_message_at: "2026-08-05 10:00:00",
  ...over,
});

// --- WhatsApp destination -------------------------------------------------

test("a WhatsApp self-chat JID that was actually observed is preferred", () => {
  const resolved = resolveWhatsAppSelfTarget({
    linkedNumber: "+31 600 000 000",
    linkedName: "Kuzey",
    chats: [
      chat({ chat_id: "31600000000@lid", last_message_at: "2026-08-05 12:00:00" }),
      chat({ last_message_at: "2026-08-01 09:00:00" }),
    ],
    normalize: normalizeWhatsAppIdentifier,
  });
  assert.equal(resolved.ok, true);
  // The linked-identity domain is the one WhatsApp actually delivered on, so a
  // constructed s.whatsapp.net JID must not win over it.
  assert.equal(resolved.target.chatId, "31600000000@lid");
  assert.equal(resolved.target.via, "observed-self-chat");
  assert.equal(resolved.target.label, "Kuzey");
});

test("a linked number with no observed self-chat still produces a destination", () => {
  const resolved = resolveWhatsAppSelfTarget({
    linkedNumber: "31600000000",
    linkedName: null,
    chats: [],
    normalize: normalizeWhatsAppIdentifier,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.target.chatId, "31600000000@s.whatsapp.net");
  assert.equal(resolved.target.via, "linked-number");
});

test("someone else's chat is never mistaken for the self-chat", () => {
  const resolved = resolveWhatsAppSelfTarget({
    linkedNumber: "31600000000",
    linkedName: null,
    chats: [
      chat({
        chat_id: "49111111111@s.whatsapp.net",
        contact_number: "49111111111",
        contact_label: "Someone else",
        last_message_at: "2026-08-05 23:00:00",
      }),
      chat({ chat_id: "120363000000@g.us", is_group: 1, last_message_at: "2026-08-05 23:30:00" }),
    ],
    normalize: normalizeWhatsAppIdentifier,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.target.chatId, "31600000000@s.whatsapp.net");
});

test("an unlinked WhatsApp reports that rather than guessing", () => {
  const resolved = resolveWhatsAppSelfTarget({
    linkedNumber: null,
    chats: [],
    normalize: normalizeWhatsAppIdentifier,
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, "whatsapp_not_linked");
  assert.match(explainSelfTargetFailure(resolved.reason), /Settings → Messaging/);
});

// --- Telegram destination -------------------------------------------------

const tgChat = (over = {}) => ({
  chat_id: "123456789",
  user_id: 1,
  contact_label: "Kuzey",
  contact_handle: "@kuzey",
  is_group: 0,
  last_message_at: "2026-08-05 10:00:00",
  ...over,
});

test("the owner's most recent private Telegram chat is the destination", () => {
  const resolved = resolveTelegramSelfTarget({
    linked: true,
    ownerUserId: 1,
    chats: [
      tgChat({ chat_id: "111", last_message_at: "2026-08-01 10:00:00" }),
      tgChat({ chat_id: "222", last_message_at: "2026-08-05 18:00:00" }),
    ],
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.target.chatId, "222");
});

test("a group is never the destination, even when it is the newest chat", () => {
  const resolved = resolveTelegramSelfTarget({
    linked: true,
    ownerUserId: 1,
    chats: [
      tgChat({ chat_id: "-1001234", is_group: 1, last_message_at: "2026-08-05 23:00:00" }),
      tgChat({ chat_id: "555", last_message_at: "2026-08-02 09:00:00" }),
    ],
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.target.chatId, "555");
});

test("another Breadboard account's Telegram chat is not reachable", () => {
  const resolved = resolveTelegramSelfTarget({
    linked: true,
    ownerUserId: 1,
    chats: [tgChat({ chat_id: "999", user_id: 2 })],
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, "telegram_no_owner_chat");
});

test("a bot that has never been messaged explains why it cannot start", () => {
  const resolved = resolveTelegramSelfTarget({ linked: true, ownerUserId: 1, chats: [] });
  assert.equal(resolved.ok, false);
  assert.match(explainSelfTargetFailure(resolved.reason), /cannot start a conversation/);
});

// --- Intent ---------------------------------------------------------------

const fire = (text, priorMessages) =>
  messagingCommandText({
    text,
    surface: "dashboard_terminal",
    authenticated: true,
    priorMessages,
  });

test("plain send requests select the skill", () => {
  for (const text of [
    "send this to my whatsapp",
    "send that summary to my telegram please",
    "can you text this to me",
    "whatsapp me this",
    "forward the report to my phone",
    "telegram this to me",
  ]) {
    const selection = fire(text);
    assert.equal(selection.automatic, true, text);
    assert.ok(selection.text.startsWith("/send-to-my-phone "), text);
  }
});

test("talking about the messaging feature does not select the skill", () => {
  for (const text of [
    "how does the whatsapp integration work",
    "the telegram gateway long-polls getUpdates",
    "I already sent this to my whatsapp",
    "add a test for whatsapp",
    "does whatsapp support editing messages",
  ]) {
    assert.equal(fire(text).automatic, false, text);
  }
});

test("a turn that already selected a skill is left alone", () => {
  assert.equal(fire("/premortem send this to my whatsapp").automatic, false);
});

test("answering 'which app?' still counts as the same errand", () => {
  const selection = fire("telegram", [
    { role: "assistant", content: "Both are linked — WhatsApp or Telegram?" },
  ]);
  assert.equal(selection.automatic, true);
});

test("the same short word without that question does not fire", () => {
  assert.equal(fire("telegram", [{ role: "assistant", content: "Done." }]).automatic, false);
});

test("anonymous Quartz never selects the skill", () => {
  const selection = messagingCommandText({
    text: "send this to my whatsapp",
    surface: "quartz_ai",
    authenticated: false,
  });
  assert.equal(selection.automatic, false);
});

// --- Wiring ---------------------------------------------------------------

test("the tool is in scope for both authenticated chat surfaces, never Quartz", () => {
  assert.deepEqual([...MESSAGING_TOOLS], ["messaging_send"]);
  assert.ok(allowedToolsForSurface("dashboard_terminal").includes("messaging_send"));
  assert.ok(allowedToolsForSurface("garden_chat").includes("messaging_send"));
  assert.ok(!allowedToolsForSurface("quartz_ai").includes("messaging_send"));
});

test("the broker can switch the tool on, and switches it off for Quartz", () => {
  assert.match(broker, /\.\.\.MESSAGING_TOOLS,/);
  assert.match(broker, /for \(const tool of MESSAGING_TOOLS\) map\[tool\] = false;/);
});

test("the tool is registered where the running runtime actually reads it", () => {
  // hermes-config/tool/*.ts is OpenCode-era and is not loaded: start-hermes.mjs
  // writes `toolsets: [breadboard]`, which is this Python plugin.
  assert.match(pluginManifest, /^ {2}- messaging_send$/m);
  assert.match(pluginModule, /"messaging_send",\s*\n\s*"\/api\/hermes\/tools\/messaging",/);
});

test("the route refuses anything but its own tool, skill, surface and run", () => {
  assert.match(route, /tokenAllows\(verified\.token, \{ tool: "messaging_send" \}\)/);
  assert.match(route, /selectedConditionalSkills\.includes\("send-to-my-phone"\)/);
  assert.match(route, /\["dashboard_terminal", "garden_chat"\]\.includes\(session\.surface\)/);
  assert.match(route, /getActiveRuntimeRun\(session\.id\)/);
});

test("the skill declares the tool it needs and both surfaces it runs on", () => {
  assert.match(skill, /^name: send-to-my-phone$/m);
  assert.match(skill, /surfaces: \[dashboard_terminal, garden_chat\]/);
  assert.match(skill, /requiredTools:\r?\n {4}- messaging_send/);
  // The description is the only text always in context, so the trigger phrases
  // have to live there rather than in the body.
  assert.match(skill, /^description:.*whatsapp.*telegram/im);
});

test("the skill is actually discovered, healthy and ready — not silently dark", () => {
  // The agent-loop skill's failure mode: everything wired, the skill unusable
  // because discovery marked it unavailable. Assert the resolved state, not the
  // files that are supposed to produce it.
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const found = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === "send-to-my-phone",
    );
    assert.ok(found, `not discovered for ${surface}`);
    assert.equal(found.healthy, true, surface);
    assert.equal(found.enabled, true, surface);
    assert.equal(found.availability, "ready", surface);
    assert.deepEqual(found.capabilityContract?.requiredTools, ["messaging_send"]);
  }
  const onQuartz = listFirstPartySkills("quartz_ai").find(
    (candidate) => candidate.slug === "send-to-my-phone",
  );
  assert.notEqual(onQuartz?.availability, "ready");
});

test("the intent runs last so an explicit skill keeps the turn", () => {
  for (const file of [turnService, gardenAdapter]) {
    const loopAt = file.indexOf("agentLoopCommandText({");
    const messagingAt = file.indexOf("messagingCommandText({");
    assert.ok(loopAt >= 0 && messagingAt > loopAt);
    assert.ok(file.indexOf("resolveCommandMessage(") > messagingAt);
  }
});

test("the destination is never taken from the model", () => {
  // The whole safety property: no chatId, recipient, number or handle argument
  // is read out of the tool payload anywhere in the service.
  assert.ok(!/args\.(chatId|to|recipient|number|handle|phone)/.test(service));
  assert.match(service, /resolveWhatsAppSelfTarget|resolveTelegramSelfTarget/);
});

test("an attachment cannot cross a conversation boundary", () => {
  assert.match(service, /artifact\.conversation_id !== input\.conversationId/);
  assert.match(service, /artifact\.user_id !== input\.userId/);
});

test("bursts are capped so a loop cannot get the account restricted", () => {
  assert.match(service, /RATE_LIMIT = \{ max: 6, windowMs: 60_000 \}/);
});

test("both transports can carry a file", () => {
  assert.match(whatsAppBridge, /async sendMedia\(/);
  assert.match(whatsAppBridge, /\/send-media/);
  assert.match(telegramClient, /export async function sendDocument\(/);
  // Telegram caps captions far below its message limit; the overflow is sent
  // rather than silently dropped.
  assert.match(telegramClient, /slice\(0, 1_024\)/);
  assert.match(service, /text\.length > 1_024/);
});

test("every delivered outbound message opens the Terminal continuation it is bound to", () => {
  assert.match(service, /export async function recordDeliveredOwnerMessage/);
  assert.match(service, /createConversation\(\{/);
  assert.match(service, /appendConversationAssistantMessage\(\{/);
  assert.match(service, /externalMessagingDirection: input\.direction/);
  assert.match(service, /store\.bindConversation\(input\.target\.chatId, conversation\.id\)/);
  assert.match(service, /continuationConversationId: continuation\.public_id/);
  assert.ok(
    service.indexOf("await deliverWhatsApp") < service.indexOf("await recordDeliveredOwnerMessage"),
    "only a provider-accepted message should be represented as delivered",
  );
});
