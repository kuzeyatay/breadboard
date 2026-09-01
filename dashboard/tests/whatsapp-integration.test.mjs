import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { normalizeInbound } from "../src/lib/whatsapp/bridge.ts";
import {
  conversationIsWarm,
  messageText,
  HELP_TEXT,
} from "../src/lib/whatsapp/inbound-policy.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const bridge = source("../src/lib/whatsapp/bridge.ts");
const inbound = source("../src/lib/whatsapp/inbound.ts");
const service = source("../src/lib/whatsapp/service.ts");
const status = source("../src/lib/whatsapp/status.ts");
const gatewayService = source("../scripts/runtime-v2-whatsapp-gateway-service.mjs");
const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
const panel = source("../src/app/components/settings-whatsapp.tsx");
const messaging = source("../src/app/components/settings-messaging.tsx");
const settingsDialog = source("../src/app/components/settings-dialog.tsx");
const turnService = source("../src/lib/conversations/turn-service.ts");
const connectionRoute = source("../src/app/api/whatsapp/connection/route.ts");
const statusRoute = source("../src/app/api/whatsapp/route.ts");
const db = source("../src/lib/db.ts");
// The upstream bridge Breadboard drives. Its contract is the integration.
const hermesBridge = source(
  "../../hermes-agent/scripts/whatsapp-bridge/bridge.js",
);

test("the bridge event shape survives fields the bridge may or may not send", () => {
  const event = normalizeInbound({
    messageId: "3EB0",
    chatId: "31612345678@s.whatsapp.net",
    senderId: "31612345678@s.whatsapp.net",
    senderName: "Kuzey",
    isGroup: false,
    body: "hello",
    timestamp: 1_800_000_000,
  });
  assert.equal(event.messageId, "3EB0");
  assert.equal(event.body, "hello");
  assert.equal(event.hasMedia, false);
  assert.equal(event.chatName, "");
  assert.equal(event.timestamp, 1_800_000_000);

  // A malformed entry must not throw mid-drain and lose the rest of the batch.
  const empty = normalizeInbound({});
  assert.equal(empty.chatId, "");
  assert.ok(Number.isFinite(empty.timestamp));
});

test("Breadboard drives the same pairing and gateway modes the Hermes CLI does", () => {
  // Pair mode: JSON events on stdout, including the QR payload.
  assert.match(hermesBridge, /const PAIR_ONLY = args\.includes\('--pair-only'\)/);
  assert.match(hermesBridge, /const PAIR_JSON = args\.includes\('--pair-json'\)/);
  assert.match(hermesBridge, /emitPairEvent\(\{ event: 'qr', qr \}\)/);
  assert.match(bridge, /"--pair-only",\s*"--pair-json"/);
  assert.match(bridge, /event\.event === "qr"/);

  // Gateway mode: the loopback HTTP contract Breadboard polls and sends through.
  for (const route of ["/messages", "/send", "/typing", "/health"]) {
    assert.ok(
      hermesBridge.includes(`'${route}'`),
      `the Hermes bridge no longer serves ${route}`,
    );
    assert.ok(bridge.includes(route), `Breadboard no longer uses ${route}`);
  }
});

test("a WhatsApp message goes through the same authenticated turn pipeline as the browser", () => {
  assert.match(inbound, /createConversation\(/);
  assert.match(inbound, /startConversationTurn\(/);
  assert.match(inbound, /resolveConversationRuntime\(/);
  // The chat must be a Terminal chat, which is what makes it show up in the
  // desktop app's Recents rather than living only inside WhatsApp.
  assert.match(inbound, /surface: "dashboard_terminal"/);
  // The pump is attached before dispatch, exactly like the browser does.
  assert.ok(
    inbound.indexOf("startSessionEventPump") < inbound.indexOf("startConversationTurn("),
    "the event pump must be started before the turn is dispatched",
  );
  // An unattended message must never sit waiting on a permission prompt.
  assert.match(inbound, /"blocked" in result/);
  // WhatsApp has no composer switch, so its default must be explicit rather
  // than inheriting the ordinary-agent default from the shared turn service.
  assert.match(inbound, /superAgent: true/);
  // And the runtime is checked before anything is created.
  assert.ok(
    inbound.indexOf("requireEnabled()") < inbound.indexOf("createConversation("),
    "a stopped runtime must not leave an empty chat behind",
  );
});

test("an inbound message wakes the on-demand runtime, and a failed turn strands no empty chat", () => {
  // The gateway process holds no supervisor control, so the on-demand Hermes
  // service must be woken (via the dashboard) before the turn — and before any
  // conversation exists, so a runtime that cannot come back fails cleanly.
  assert.match(inbound, /wakeAgentRuntime\("whatsapp-inbound"\)/);
  assert.ok(
    inbound.indexOf("wakeAgentRuntime(") < inbound.indexOf("createConversation("),
    "the runtime must be woken before a conversation is created",
  );
  // If the turn still dies before persisting anything, the fresh conversation
  // is removed rather than left as an empty chat in Recents.
  assert.match(inbound, /deleteConversation\(createdConversation\)/);
});

test("a WhatsApp turn runs on the owner's selected model, not the hardcoded default", () => {
  // There is no model picker in WhatsApp, so the saved Intelligence preference
  // is the selection. Omitting it silently routes to DEFAULT_MODEL, which is a
  // different model than the app itself answers with.
  assert.match(inbound, /getHermesUserSettings\(settings\.ownerUserId\)/);
  assert.match(inbound, /model: preference\.defaultModel/);
  assert.match(inbound, /reasoningEffort: preference\.reasoningEffort/);
  assert.ok(
    inbound.indexOf("getHermesUserSettings(") < inbound.indexOf("startConversationTurn("),
    "the preference must be read before the turn is dispatched",
  );
});

test("the agent is told it is answering into WhatsApp, not the app window", () => {
  // The chat is a Terminal chat, so nothing else in the turn distinguishes a
  // message read on a phone from one read in the Breadboard window.
  assert.match(inbound, /deliveryChannel: "whatsapp"/);
  assert.match(turnService, /renderDeliveryChannel\(context\.deliveryChannel\)/);
  // A browser must not be able to claim it is WhatsApp.
  assert.match(turnService, /DELIVERY_CHANNELS\.includes\(/);

  const notice = turnService.slice(
    turnService.indexOf("function renderDeliveryChannel"),
    turnService.indexOf("function authorizedGardenContext"),
  );
  assert.match(notice, /# delivery_channel/);
  assert.match(notice, /const app = channel === "whatsapp" \? "WhatsApp"/);
  // The constraints that actually differ from the app window.
  assert.match(notice, /message on their phone/);
  assert.match(notice, /Only your final text is delivered/);
  assert.match(notice, /no headings, tables, bullet syntax or links/);
  assert.match(notice, /4000 characters/);
  assert.match(notice, /cannot ask for a permission decision/);
});

test("only the paired owner's allowed numbers can spend tokens", () => {
  assert.match(inbound, /settings\.ownerUserId === null/);
  assert.match(inbound, /senderIsAllowed\(message\.senderId, settings\.allowedNumbers, settings\.mode\)/);
  // The bridge gates too, but it is a separate process reading a possibly stale
  // environment, so the decision is re-made here.
  assert.match(hermesBridge, /matchesAllowedUser\(senderId, ALLOWED_USERS, SESSION_DIR\)/);
  // Routes refuse anyone who is not the owner of the linked device.
  assert.match(connectionRoute, /store\.requireOwner\(userId\)/);
  assert.match(statusRoute, /store\.requireOwner\(userId\)/);
});

test("a redelivered message never produces a second turn or a second reply", () => {
  assert.match(service, /claimMessage\(message\.messageId\)/);
  // Per-chat serialization: a burst cannot open two turns on one conversation.
  assert.match(service, /function serialize\(/);
  assert.match(service, /serialize\(message\.chatId, \(\) => handleMessage\(message\)\)/);
});

test("the gateway loop and bridge tree live in the native-owned Runtime service", () => {
  assert.match(gatewayService, /startRuntimeV2GatewayHttpService/);
  assert.match(gatewayService, /BREADBOARD_WHATSAPP_GATEWAY_TOKEN/);
  assert.match(connectionRoute, /reconcileRuntimeGateway\("whatsapp", "running", userId\)/);
  assert.match(service, /__breadboardWhatsAppPolling/);
  assert.match(service, /timer\.unref\(\)/);
  // Autostart must not be able to break server startup: the conversation stack is
  // only imported when a message actually needs it, never at boot.
  assert.match(service, /await import\("\.\/inbound\.ts"\)/);
  assert.match(service, /await import\("\.\/instance\.ts"\)/);
  assert.doesNotMatch(service, /^import .*from "\.\/inbound\.ts"/m);
  assert.doesNotMatch(service, /^import .*from "\.\/instance\.ts"/m);
  assert.doesNotMatch(statusRoute, /whatsapp\/service|whatsapp\/bridge/);
});

test("the raw pairing payload never leaves the server", () => {
  // Only the rendered image is exposed; `qr` is not part of the status payload.
  assert.match(status, /qrImage/);
  assert.match(status, /QRCode\.toDataURL/);
  assert.doesNotMatch(status, /qr: snapshot\.qr/);
  assert.doesNotMatch(panel, /status\.qr\b(?!Image|At)/);
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
    mediaType: "image",
    fileName: "note.jpg",
  });
  assert.match(withCaption, /what does this say\?/);
  assert.match(withCaption, /cannot open WhatsApp attachments yet/);

  const withoutCaption = messageText({
    body: "",
    hasMedia: true,
    mediaType: "audio",
    fileName: "",
  });
  assert.match(withoutCaption, /attached a audio/);

  assert.equal(messageText({ body: " hi ", hasMedia: false }), "hi");
});

test("/help answers without opening a chat", () => {
  assert.match(HELP_TEXT, /\/new/);
  assert.match(inbound, /command === "\/help"/);
  assert.match(inbound, /const forceNew = command === "\/new"/);
});

test("linking a phone lives in Settings → Messaging, not in the terminal bar", () => {
  assert.match(settingsDialog, /value: "messaging"/);
  assert.match(settingsDialog, /<SettingsMessaging \/>/);
  assert.match(messaging, /import SettingsWhatsApp, \{ MessageBubbleIcon, useWhatsAppStatus \}/);
  assert.match(messaging, /<SettingsWhatsApp status=\{whatsApp\.status\} refresh=\{whatsApp\.refresh\} \/>/);
  // The old chat-bar control is gone: a once-a-year setup task does not hold
  // permanent space next to Artifacts.
  assert.doesNotMatch(terminal, /WhatsAppPanel|whatsAppStatus|MessageBubbleIcon/);
});

test("the section is line art in Breadboard's own weight, not a brand mark", () => {
  assert.match(panel, /stroke="currentColor"/);
  assert.doesNotMatch(panel, /#25D366/);
  assert.doesNotMatch(panel, /fill="currentColor"/);
  // Both services keep polling while the tab is open, so the picker's dots are
  // honest for the one that is not on screen.
  assert.match(messaging, /useWhatsAppStatus\(service === "whatsapp"\)/);
  assert.match(messaging, /useTelegramStatus\(service === "telegram"\)/);
});

test("the panel states the risk of the unofficial bridge", () => {
  assert.match(panel, /not an official WhatsApp integration/);
  assert.match(panel, /Linked devices/);
  assert.match(panel, /Unlink device/);
});

test("the WhatsApp tables are created with the rest of the schema", () => {
  assert.match(db, /ensureWhatsAppSchema\(db\)/);
  assert.ok(
    db.indexOf("ensureConversationSchema(db)") < db.indexOf("ensureWhatsAppSchema(db)"),
    "whatsapp_chats references conversations, so that table must exist first",
  );
});
