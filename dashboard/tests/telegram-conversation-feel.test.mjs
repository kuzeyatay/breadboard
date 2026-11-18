import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { telegramMediaMethod } from "../src/lib/telegram/client.ts";
import { takeTelegramBurst } from "../src/lib/telegram/service.ts";

const message = (id, body, extra = {}) => ({
  messageId: `42:${id}`, updateId: id, chatId: "42", chatType: "private", chatTitle: "",
  senderId: "7", senderUsername: "me", senderName: "Me", isGroup: false, body,
  hasMedia: false, mediaType: "", fileName: "", timestamp: id, attachments: [], ...extra,
});

test("a burst of texts is answered as one turn, named by its last message", () => {
  const photo = { fileId: "p1", name: "photo.jpg", mimeType: "image/jpeg" };
  const pending = [
    message(1, "hey"),
    message(2, "", { hasMedia: true, mediaType: "photo", attachments: [photo] }),
    message(3, "what is in this picture?"),
    message(4, "/new"),
    message(5, "next"),
  ];
  const merged = takeTelegramBurst(pending);
  assert.equal(merged.body, "hey\nwhat is in this picture?");
  assert.deepEqual(merged.attachments, [photo]);
  assert.equal(merged.hasMedia, true);
  assert.equal(merged.messageId, "42:3");
  // A command is never folded into prose, and what follows it is its own burst.
  assert.equal(takeTelegramBurst(pending).body, "/new");
  assert.equal(takeTelegramBurst(pending).body, "next");
  assert.equal(takeTelegramBurst(pending), null);
});

test("files go back the way a person sends them", () => {
  assert.equal(telegramMediaMethod("image/png", 2_000).method, "sendPhoto");
  assert.equal(telegramMediaMethod("image/png", 20 * 1024 * 1024).method, "sendDocument");
  assert.equal(telegramMediaMethod("video/mp4", 5_000_000).method, "sendVideo");
  assert.equal(telegramMediaMethod("image/gif", 5_000).method, "sendAnimation");
  assert.equal(telegramMediaMethod("audio/mpeg", 5_000).method, "sendAudio");
  assert.equal(telegramMediaMethod("application/pdf", 5_000).method, "sendDocument");
  assert.equal(telegramMediaMethod("image/svg+xml", 5_000).method, "sendDocument");
});

test("mid-answer texts steer the live run, keep the typing indicator, and files follow the text", () => {
  const service = fs.readFileSync(new URL("../src/lib/telegram/service.ts", import.meta.url), "utf8");
  const inbound = fs.readFileSync(new URL("../src/lib/telegram/inbound.ts", import.meta.url), "utf8");
  assert.match(service, /if \(await steerTelegramTurn\(conversation, next\)\) return true;/);
  // Texts sent while a cold turn was still starting are steered, not held back.
  assert.match(service, /const early = box\.pending\.filter/);
  assert.match(service, /setInterval\(\(\) => void gateway\.sendTyping\(message\.chatId\), TYPING_REFRESH_MS\)/);
  assert.match(service, /sendTurnMedia\(message\.chatId, turn, outcome\.reply, sent\)/);
  // A refused steer is never dropped: it is queued and answered after the turn.
  assert.match(service, /if \(!steered\) queue\(\)/);
  assert.match(inbound, /"session\.redirect"|steerRun\(/);
  assert.match(inbound, /deps\.onTurnStarted\?\.\(conversation\)/);
});

test("a stray rejection or exception never takes the bot offline once it is serving", () => {
  const script = fs.readFileSync(new URL("../scripts/runtime-v2-telegram-gateway-service.mjs", import.meta.url), "utf8");
  assert.match(script, /process\.on\("unhandledRejection", survive\(/);
  assert.match(script, /process\.on\("uncaughtException", survive\(/);
  assert.match(script, /if \(!started\) process\.exit\(1\)/);
  assert.match(script, /onStarted: async \(\) => \{\s+started = true;/);
});
