import type { InboundAttachment } from "../messaging-attachments/types.ts";
import { attachmentName } from "../messaging-attachments/types.ts";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const string = (value: unknown) => typeof value === "string" ? value : "";

/** Select the full file (not its thumbnail), retaining filename/MIME from Message. */
export function telegramAttachments(message: RecordValue, depth = 0): InboundAttachment[] {
  if (depth > 4) return [];
  const files: InboundAttachment[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, name: string, mime: string, voice = false) => {
    const file = record(value);
    const fileId = string(file.file_id);
    if (!fileId || seen.has(fileId)) return;
    seen.add(fileId);
    files.push({ fileId, name: attachmentName(string(file.file_name), name), mimeType: string(file.mime_type) || mime,
      ...(typeof file.file_size === "number" ? { sizeBytes: file.file_size } : {}), ...(voice ? { voice: true } : {}) });
  };
  const photo = (value: unknown) => {
    if (!Array.isArray(value)) return;
    const largest = [...value].sort((a, b) => {
      const size = (item: unknown) => { const p = record(item); return Number(p.width) * Number(p.height) || Number(p.file_size) || 0; };
      return size(b) - size(a);
    })[0];
    add(largest, "photo.jpg", "image/jpeg");
  };
  photo(message.photo);
  // Animations also carry a document field for older clients: keep one copy.
  add(message.animation, "animation.mp4", "video/mp4");
  add(message.document, "document.bin", "application/octet-stream");
  add(message.voice, "voice.ogg", "audio/ogg", true);
  add(message.audio, "audio.mp3", "audio/mpeg");
  add(message.video, "video.mp4", "video/mp4");
  add(message.video_note, "video-note.mp4", "video/mp4");
  const sticker = record(message.sticker);
  add(sticker, sticker.is_video ? "sticker.webm" : sticker.is_animated ? "sticker.tgs" : "sticker.webp",
    sticker.is_video ? "video/webm" : sticker.is_animated ? "application/x-tgsticker" : "image/webp");
  const live = record(message.live_photo);
  photo(live.photo);
  add(live, "live-photo.mp4", "video/mp4");
  for (const key of ["contact", "location", "venue", "poll", "dice", "game", "checklist", "story", "paid_media"] as const) {
    if (!message[key]) continue;
    const value = record(message[key]);
    files.push({ name: `${key}.json`, mimeType: "application/json", text: JSON.stringify(value, null, 2) });
    if (key === "contact" && string(value.vcard)) files.push({ name: "contact.vcf", mimeType: "text/vcard", text: string(value.vcard) });
  }
  const poll = record(message.poll);
  const paid = record(message.paid_media);
  const nested = [message.game, poll.media, poll.explanation_media,
    ...(Array.isArray(poll.options) ? poll.options.map((option) => record(option).media) : []),
    ...(Array.isArray(paid.paid_media) ? paid.paid_media : [])];
  for (const value of nested) {
    for (const file of telegramAttachments(record(value), depth + 1)) {
      if (file.fileId && seen.has(file.fileId)) continue;
      if (file.fileId) seen.add(file.fileId);
      files.push(file);
    }
  }
  return files;
}
