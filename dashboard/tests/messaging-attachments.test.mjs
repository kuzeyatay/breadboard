import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import AdmZip from "adm-zip";
import { telegramAttachments } from "../src/lib/telegram/attachments.ts";
import { normalizeInbound as telegramMessage, TelegramGateway } from "../src/lib/telegram/gateway.ts";
import { normalizeInbound as whatsAppMessage } from "../src/lib/whatsapp/bridge.ts";
import { downloadTelegramFile } from "../src/lib/telegram/client.ts";
import { storeMessagingAttachment, prepareMessagingAttachments, openCachedAttachment } from "../src/lib/messaging-attachments/store.ts";
import { attachmentMessageText } from "../src/lib/messaging-attachments/types.ts";
import { messagingGatewayChannel } from "../src/lib/messaging-attachments/gateway-auth.ts";
import { chatMessageAttachments, reusableChatAttachments } from "../src/lib/chat-attachments.ts";
import { stageEditableDocumentAttachments } from "../src/lib/document-attachments-server.ts";
import { findStoredFileBlob } from "../src/lib/conversations/stored-file-blob-store.ts";

const TOKEN = "12345:fixture-token-not-a-real-credential";
const png = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "messaging-attachments-"));
  const env = { BREADBOARD_DATA_DIR: root, BREADBOARD_CHAT_AUDIO_DIR: path.join(root, "audio"), BREADBOARD_CHAT_VIDEO_DIR: path.join(root, "video"), BREADBOARD_CHAT_DOCUMENT_DIR: path.join(root, "documents") };
  const old = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

test("Telegram selects the largest photo and all native file kinds without duplicating animations", () => {
  const files = telegramAttachments({
    photo: [{ file_id: "small", width: 10, height: 10 }, { file_id: "full", width: 100, height: 100 }],
    animation: { file_id: "anim" }, document: { file_id: "anim" },
    voice: { file_id: "voice" }, audio: { file_id: "song", file_name: "track.mp3" },
    video: { file_id: "video" }, video_note: { file_id: "round" },
    sticker: { file_id: "sticker", is_video: true },
  });
  assert.deepEqual(files.map((file) => file.fileId), ["full", "anim", "voice", "song", "video", "round", "sticker"]);
  assert.equal(files.find((file) => file.fileId === "voice").voice, true);
  assert.equal(files.at(-1).name, "sticker.webm");
  assert.equal(telegramAttachments({ sticker: { file_id: "s", is_animated: true } })[0].name, "sticker.tgs");
});

test("contacts, locations, venues, polls and live photos preserve their actual contents", () => {
  const payload = { contact: { first_name: "Ada", phone_number: "+123", vcard: "BEGIN:VCARD\nFN:Ada\nEND:VCARD" }, location: { latitude: 52.1, longitude: 4.3 }, venue: { title: "Library", address: "Main St" }, poll: { question: "When?", options: [{ text: "Friday" }] }, live_photo: { photo: [{ file_id: "p" }], file_id: "v" } };
  const message = telegramMessage({ message: { ...payload, chat: { id: 1 }, from: { id: 1 }, message_id: 2 } });
  assert.equal(message.hasMedia, true);
  assert.ok(message.attachments.some((file) => file.text?.includes("Friday")));
  assert.ok(message.attachments.some((file) => file.text?.includes("52.1")));
  assert.equal(message.attachments.find((file) => file.name === "contact.vcf").text, payload.contact.vcard);
  assert.deepEqual(message.attachments.filter((file) => file.fileId).map((file) => file.fileId), ["p", "v"]);
});

test("WhatsApp retains cache references, MIME, voice flags and native contact data", () => {
  const voice = whatsAppMessage({ hasMedia: true, mediaType: "ptt", mime: "audio/ogg; codecs=opus", mediaUrls: ["C:/cache/voice.ogg"], body: "[ptt received]" });
  assert.equal(voice.attachments[0].filePath, "C:/cache/voice.ogg");
  assert.equal(voice.attachments[0].voice, true);
  assert.match(attachmentMessageText(voice), /transcribe/);
  const contacts = whatsAppMessage({ nativeMetadata: { contacts: [{ displayName: "Ada", vcard: "FN:Ada" }] } });
  assert.equal(contacts.hasMedia, true);
  assert.match(contacts.attachments[0].text, /FN:Ada/);
});

test("Telegram download -> vision attachment -> saved chat -> reopen retains image bytes", async (t) => {
  fixture(t);
  const bytes = await png();
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push(req.url);
    if (req.url.endsWith("/getFile")) res.end(JSON.stringify({ ok: true, result: { file_path: "photos/file.png" } }));
    else res.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const old = process.env.BREADBOARD_TELEGRAM_API_BASE;
  process.env.BREADBOARD_TELEGRAM_API_BASE = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { if (old === undefined) delete process.env.BREADBOARD_TELEGRAM_API_BASE; else process.env.BREADBOARD_TELEGRAM_API_BASE = old; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const message = telegramMessage({ message: { chat: { id: 1 }, photo: [{ file_id: "photo", file_size: bytes.length }] } });
  const attachments = await prepareMessagingAttachments({ userId: 7, hasMedia: true, files: message.attachments, open: (file) => downloadTelegramFile(TOKEN, file.fileId) });
  assert.deepEqual(Buffer.from(attachments[0].dataUrl.split(",")[1], "base64"), bytes);
  const saved = chatMessageAttachments(attachments);
  const restored = reusableChatAttachments(saved);
  assert.equal(restored[0].dataUrl, attachments[0].dataUrl);
  assert.deepEqual(calls, [`/bot${TOKEN}/getFile`, `/file/bot${TOKEN}/photos/file.png`]);
});

test("WhatsApp cache -> owner storage -> runtime workspace preserves files and blocks other owners", async (t) => {
  const root = fixture(t);
  const cache = path.join(root, "cache"); fs.mkdirSync(cache);
  const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace);
  const cases = [
    ["voice.ogg", "audio/ogg", Buffer.from("OggS\0voice"), "audio"],
    ["movie.mp4", "video/mp4", Buffer.from("video bytes"), "video"],
    ["calendar.ics", "text/calendar", Buffer.from("BEGIN:VCALENDAR\nEND:VCALENDAR"), "text"],
    ["data.custom", "application/octet-stream", Buffer.from([0, 1, 2, 3]), "text"],
    ["source.py", "text/plain", Buffer.from("print('hello')"), "text"],
  ];
  for (const [name, mime, bytes, type] of cases) {
    const filePath = path.join(cache, name); fs.writeFileSync(filePath, bytes);
    const message = whatsAppMessage({ hasMedia: true, fileName: name, mime, mediaUrls: [filePath] });
    const attachments = await prepareMessagingAttachments({ userId: 7, hasMedia: true, files: message.attachments, open: (file) => openCachedAttachment(file.filePath, [cache]) });
    assert.equal(attachments[0].type, type);
    const restored = reusableChatAttachments(chatMessageAttachments(attachments));
    const staged = stageEditableDocumentAttachments({ userId: 7, workspace, attachments: restored });
    assert.equal(staged.paths.length, 1, name);
    assert.deepEqual(fs.readFileSync(path.join(workspace, staged.paths[0].path)), bytes);
    assert.equal(stageEditableDocumentAttachments({ userId: 8, workspace, attachments }).paths.length, 0);
    if (name === "data.custom") assert.ok(staged.paths[0].path.endsWith(".custom"));
  }
});

test("Office documents retain table text and originals; unknown extensions still download", async (t) => {
  fixture(t);
  const archive = new AdmZip();
  archive.addFile("word/document.xml", Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Attachment evidence 42</w:t></w:r></w:p></w:body></w:document>'));
  const attachment = await storeMessagingAttachment(7, { name: "report.docx", mimeType: "application/octet-stream" }, new Blob([archive.toBuffer()]).stream());
  assert.equal(attachment.type, "document");
  assert.match(attachment.text, /Attachment evidence 42/);
  const bytes = Buffer.from([0, 255, 123]);
  const generic = await storeMessagingAttachment(7, { name: "../secret.weird", mimeType: "application/octet-stream" }, new Blob([bytes]).stream());
  assert.equal(generic.name, "secret.weird");
  assert.equal(generic.format, "bin");
  assert.deepEqual(fs.readFileSync(findStoredFileBlob({ userId: 7, blobId: generic.blobId }).path), bytes);
});

test("cache reads reject traversal, URLs and symlink escapes", async (t) => {
  const root = fixture(t);
  const cache = path.join(root, "cache"); fs.mkdirSync(cache);
  const outside = path.join(root, "outside"); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "not an attachment");
  fs.symlinkSync(outside, path.join(cache, "link"), process.platform === "win32" ? "junction" : "dir");
  for (const file of [path.join(cache, "../outside/secret.txt"), path.join(cache, "link/secret.txt"), "https://example.com/file"]) {
    await assert.rejects(openCachedAttachment(file, [cache]));
  }
});

test("missing, empty and interrupted attachments fail before a turn can invent their content", async (t) => {
  fixture(t);
  await assert.rejects(prepareMessagingAttachments({ userId: 7, hasMedia: true, files: [], open: () => assert.fail("must not open") }), /could not be downloaded/);
  await assert.rejects(storeMessagingAttachment(7, { name: "empty.bin", mimeType: "application/octet-stream" }, new Blob([]).stream()), /empty/);
  let disposed = false;
  await assert.rejects(prepareMessagingAttachments({ userId: 7, hasMedia: true, files: [{ name: "file.bin", mimeType: "application/octet-stream" }], open: async () => ({ body: new ReadableStream({ start(c) { c.error(new Error("stream interrupted")); } }), dispose() { disposed = true; } }) }));
  assert.equal(disposed, true);
});

test("a transcription credential is scoped to its messaging channel", (t) => {
  const old = process.env.BREADBOARD_TELEGRAM_GATEWAY_TOKEN;
  process.env.BREADBOARD_TELEGRAM_GATEWAY_TOKEN = "t".repeat(40);
  t.after(() => { if (old === undefined) delete process.env.BREADBOARD_TELEGRAM_GATEWAY_TOKEN; else process.env.BREADBOARD_TELEGRAM_GATEWAY_TOKEN = old; });
  assert.equal(messagingGatewayChannel(`Bearer ${"t".repeat(40)}`), "telegram");
  assert.equal(messagingGatewayChannel(`Bearer ${"x".repeat(40)}`), null);
  assert.equal(messagingGatewayChannel(null), null);
});

test("an album becomes one turn with every photo and caption", () => {
  const gateway = new TelegramGateway();
  gateway.queue = [1, 2, 3].map((id) => telegramMessage({ message: { chat: { id: 1 }, message_id: id, media_group_id: "album", caption: id === 1 ? "Compare these" : "", photo: [{ file_id: `photo-${id}` }] } }));
  gateway.albumUpdatedAt.set("1:album", Date.now());
  assert.deepEqual(gateway.drainMessages(), []);
  gateway.albumUpdatedAt.set("1:album", Date.now() - 1_500);
  const messages = gateway.drainMessages();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body, "Compare these");
  assert.equal(messages[0].attachments.length, 3);
  assert.deepEqual(gateway.drainMessages(), []);
});

test("Telegram reports provider limits safely and supports the local Bot API file contract", async (t) => {
  const root = fixture(t);
  const localPath = path.join(root, "local.bin"); fs.writeFileSync(localPath, "local original");
  let answer = { ok: true, result: { file_path: localPath } };
  let downloads = 0;
  const server = http.createServer((req, res) => {
    if (!req.url.endsWith("getFile")) downloads++;
    res.end(JSON.stringify(answer));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const old = process.env.BREADBOARD_TELEGRAM_API_BASE;
  process.env.BREADBOARD_TELEGRAM_API_BASE = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { if (old === undefined) delete process.env.BREADBOARD_TELEGRAM_API_BASE; else process.env.BREADBOARD_TELEGRAM_API_BASE = old; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const local = await downloadTelegramFile(TOKEN, "local");
  try { assert.equal(await new Response(local.body).text(), "local original"); } finally { local.dispose(); }
  assert.equal(downloads, 0);
  answer = { ok: false, description: `Bad Request: file is too big ${TOKEN}`, error_code: 400 };
  await assert.rejects(downloadTelegramFile(TOKEN, "large"), (error) => /20 MB/.test(error.message) && !error.message.includes(TOKEN));
  for (const file_path of ["../private", "https://elsewhere/file", "photos/../private", 123]) {
    answer = { ok: true, result: { file_path } };
    await assert.rejects(downloadTelegramFile(TOKEN, "invalid"));
  }
  assert.equal(downloads, 0);
});

test("media embedded in Telegram polls and paid-media bundles is retained with its context", () => {
  const files = telegramAttachments({ poll: { question: "Which?", media: { photo: [{ file_id: "a" }] }, options: [{ text: "One", media: { video: { file_id: "b" } } }] }, paid_media: { paid_media: [{ type: "photo", photo: [{ file_id: "c" }] }] } });
  assert.deepEqual(files.filter((file) => file.fileId).map((file) => file.fileId), ["a", "b", "c"]);
  assert.match(files.find((file) => file.name === "poll.json").text, /Which/);
});
