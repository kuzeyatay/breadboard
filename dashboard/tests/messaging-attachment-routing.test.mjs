// Exercise the real inbound routers and storage. Only the agent/speech engines
// and conversation database are replaced, so this never contacts a real chat.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import sharp from "sharp";

const dashboard = fileURLToPath(new URL("..", import.meta.url));
const stateKey = "__messagingAttachmentRouteTest";
const state = () => globalThis[stateKey];
const prefix = `const state = () => globalThis.${stateKey};\n`;
const stubs = {
  "agent-runtime/wake.ts": `export async function wakeAgentRuntime() { return true; }`,
  "conversations/store.ts": `${prefix}
    export function createConversation(input) { state().created++; return { ...input, user_id: input.userId, public_id: 'conversation-1', id: 1 }; }
    export function deleteConversation() {}
    export function getConversationById() { return null; }
    export function listConversationMessages() { return state().messages; }
    export function presentConversationMessage(row) { return row; }
    export function reserveConversationTurn() { throw new Error('Attachment consumed by reminder'); }
    export function completeAssistantMessage() { throw new Error('Attachment consumed by reminder'); }`,
  "conversations/turn-service.ts": `${prefix}
    export async function startConversationTurn(input) { state().turns.push(input); state().messages.push({ role: 'assistant', clientMessageId: input.clientMessageId, status: 'complete', content: 'I read the attachment.', orderIndex: 2 }); return { accepted: true }; }`,
  "conversations/title-service.ts": `export function fallbackConversationTitle(text) { return text.slice(0, 60); }`,
  "hermes/event-stream.ts": `export function startSessionEventPump() {}`,
  "hermes/route-core.ts": `export function requireEnabled() {}`,
  "hermes/runtime-store.ts": `export function getHermesUserSettings() { return { defaultModel: 'fixture', reasoningEffort: 'low' }; }`,
  "hermes/session-service.ts": `export async function resolveConversationRuntime() { return {}; }`,
  "schedules/instance.ts": `export function getScheduledChatJobStore() { throw new Error('Attachment must enter a turn'); }`,
  "review/delivery.ts": `${prefix}export async function handleInboundReview() { state().reviews++; return null; }`,
  "messaging-attachments/transcription.ts": `${prefix}export async function transcribeMessagingVoice(userId, channel, attachment) { state().speech.push({ userId, channel, attachment }); return 'What is two plus two?'; }`,
  "messaging-attachments/transcription-server.ts": `${prefix}export async function transcribeMessagingAudioBlob(userId, blobId) { state().speech.push({ userId, blobId }); return 'Voice transcript'; }`,
  "telegram/instance.ts": `export function getTelegramStore() { return { settings: () => ({ ownerUserId: 7 }) }; }`,
  "whatsapp/instance.ts": `export function getWhatsAppStore() { return { settings: () => ({ ownerUserId: 8 }) }; }`,
};

async function bundled(t, relative) {
  const root = fs.mkdtempSync(path.join(dashboard, ".tmp-messaging-route-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outfile = path.join(root, "entry.mjs");
  await build({ entryPoints: [path.join(dashboard, "src", relative)], outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [{ name: "test-engines", setup(builder) {
    builder.onResolve({ filter: /./ }, (args) => {
      const normalized = (args.path.startsWith("@/") ? path.join(dashboard, "src", args.path.slice(2))
        : args.path.startsWith(".") ? path.resolve(args.resolveDir, args.path) : args.path).replaceAll("\\", "/");
      const entry = Object.keys(stubs).find((key) => normalized.endsWith(`/${key}`));
      return entry ? { path: entry, namespace: "test-engine" } : undefined;
    });
    builder.onLoad({ filter: /./, namespace: "test-engine" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  } }] });
  return { root, module: await import(pathToFileURL(outfile).href) };
}

function env(t, values) {
  const old = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
function reset() { globalThis[stateKey] = { created: 0, messages: [], turns: [], reviews: 0, speech: [] }; }
function store(channel, allowed = true) {
  return { settings: () => ({ ownerUserId: 7, allowedUsers: allowed ? ["123"] : [], allowedNumbers: allowed ? ["31612345678"] : ["999"], mode: "bot" }),
    upsertChat: () => ({ conversation_id: null }), bindConversation() {} };
}

test("real WhatsApp router passes images and transcribed voice into the saved-owner turn", async (t) => {
  const { root, module } = await bundled(t, "lib/whatsapp/inbound.ts");
  const cache = path.join(root, "media"); fs.mkdirSync(cache);
  env(t, { BREADBOARD_DATA_DIR: path.join(root, "data"), HERMES_IMAGE_CACHE_DIR: cache, HERMES_AUDIO_CACHE_DIR: cache, BREADBOARD_CHAT_AUDIO_DIR: path.join(root, "audio") });
  const imagePath = path.join(cache, "photo.png");
  fs.writeFileSync(imagePath, await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).png().toBuffer());
  const { normalizeInbound } = await import("../src/lib/whatsapp/bridge.ts");
  const message = normalizeInbound({ messageId: "image-1", chatId: "31612345678@s.whatsapp.net", senderId: "31612345678@s.whatsapp.net", hasMedia: true, body: "/new", mediaType: "image", mime: "image/png", mediaUrls: [imagePath] });
  reset();
  const result = await module.routeWhatsAppMessage(message, { store: store("whatsapp") });
  assert.equal(result.status, "replied");
  assert.equal(state().turns.length, 1, "a caption that looks like /new must not drop its image");
  assert.equal(state().reviews, 0);
  assert.equal(state().turns[0].attachments[0].type, "image");
  assert.equal(state().turns[0].conversation.user_id, 7);
  assert.equal(state().turns[0].text, "/new");

  reset();
  const voicePath = path.join(cache, "voice.ogg"); fs.writeFileSync(voicePath, "OggSfixture");
  const voice = normalizeInbound({ ...message, messageId: "voice-1", body: "[ptt received]", mediaType: "ptt", mime: "audio/ogg", mediaUrls: [voicePath] });
  await module.routeWhatsAppMessage(voice, { store: store("whatsapp") });
  assert.equal(state().speech[0].userId, 7);
  assert.equal(state().speech[0].channel, "whatsapp");
  assert.equal(state().turns[0].attachments[0].type, "audio");
  assert.equal(state().turns[0].attachments[1].text, "What is two plus two?");

  reset();
  const denied = await module.routeWhatsAppMessage({ ...message, attachments: [{ filePath: "does-not-exist", name: "secret.png", mimeType: "image/png" }] }, { store: store("whatsapp", false) });
  assert.equal(denied.status, "ignored");
  assert.equal(state().created, 0);
  assert.equal(state().turns.length, 0);
});

test("real Telegram router keeps structured attachments and never treats media captions as scheduling", async (t) => {
  const { root, module } = await bundled(t, "lib/telegram/inbound.ts");
  env(t, { BREADBOARD_DATA_DIR: path.join(root, "data") });
  const { normalizeInbound } = await import("../src/lib/telegram/gateway.ts");
  const message = normalizeInbound({ message: { message_id: 1, chat: { id: 123 }, from: { id: 123 }, caption: "remind me in 5 minutes", location: { latitude: 52.1, longitude: 4.3 } } });
  reset();
  const result = await module.routeTelegramMessage(message, { store: store("telegram") });
  assert.equal(result.status, "replied");
  assert.equal(state().reviews, 0);
  assert.equal(state().turns.length, 1);
  assert.match(state().turns[0].attachments[0].text, /52.1/);
  assert.equal(state().turns[0].surfaceContext.deliveryChannel, "telegram");
  reset();
  const failed = await module.routeTelegramMessage({ ...message, attachments: [] }, { store: store("telegram") });
  assert.equal(failed.status, "failed");
  assert.match(failed.reply, /could not be downloaded/);
  assert.equal(state().created, 0);
  assert.equal(state().turns.length, 0);
  reset();
  const denied = await module.routeTelegramMessage(message, { store: store("telegram", false) });
  assert.equal(denied.status, "ignored");
  assert.equal(state().turns.length, 0);
});

test("speech proxy derives the owner from the token and rejects arbitrary account/path requests", async (t) => {
  const { module } = await bundled(t, "app/api/internal/messaging-transcription/route.ts");
  env(t, { BREADBOARD_TELEGRAM_GATEWAY_TOKEN: "t".repeat(40), BREADBOARD_WHATSAPP_GATEWAY_TOKEN: "w".repeat(40) });
  reset();
  const send = (token, body) => module.POST(new Request("http://localhost/api/internal/messaging-transcription", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const blobId = `aud_${"a".repeat(32)}`;
  assert.equal((await send("bad", { blobId })).status, 401);
  assert.equal((await send("t".repeat(40), { blobId, userId: 999 })).status, 400);
  assert.equal((await send("t".repeat(40), { blobId: "../../secret" })).status, 400);
  assert.equal((await send("t".repeat(40), { blobId: "a".repeat(1024) })).status, 413);
  assert.equal(state().speech.length, 0);
  assert.equal((await send("t".repeat(40), { blobId })).status, 200);
  assert.equal((await send("w".repeat(40), { blobId })).status, 200);
  assert.deepEqual(state().speech.map((entry) => entry.userId), [7, 8]);
});
