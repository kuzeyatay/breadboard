import { openAsBlob } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ChatAttachment } from "../chat-attachments.ts";
import { audioAttachmentFormat } from "../audio-attachments.ts";
import { videoAttachmentFormat } from "../video-attachments.ts";
import { documentAttachmentFormat } from "../document-attachments.ts";
import { storedFileAttachmentFormat, storedFileIsText } from "../stored-file-attachments.ts";
import { writeAudioBlob } from "../conversations/audio-blob-store.ts";
import { writeVideoBlob } from "../conversations/video-blob-store.ts";
import { writeDocumentBlob } from "../conversations/document-blob-store.ts";
import { writeStoredFileBlob } from "../conversations/stored-file-blob-store.ts";
import { attachmentName, type InboundAttachment } from "./types.ts";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/heic": "heic", "image/heif": "heif", "image/tiff": "tiff", "image/bmp": "bmp",
  "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac", "audio/aac": "aac",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/3gpp": "3gp",
  "application/pdf": "pdf", "text/plain": "txt", "text/vcard": "vcf", "text/calendar": "ics",
  "application/json": "json", "application/zip": "zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export interface AttachmentSource { body: ReadableStream<Uint8Array>; dispose: () => void }

/** Validate the actual target as well as the path: cache symlinks cannot expose other files. */
export async function openCachedAttachment(filePath: string, roots: readonly string[]): Promise<AttachmentSource> {
  let target: string;
  try { target = await fs.realpath(filePath); }
  catch { throw new Error("The attachment is no longer in the messaging cache. Please send it again."); }
  let allowed = false;
  for (const root of roots) {
    const realRoot = await fs.realpath(root).catch(() => null);
    if (!realRoot) continue;
    const relative = path.relative(realRoot, target);
    if (relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) allowed = true;
  }
  if (!allowed) throw new Error("The attachment is outside the messaging cache.");
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("The attachment is not a file.");
  const blob = await openAsBlob(target);
  return { body: blob.stream(), dispose: () => undefined };
}

async function readBounded(body: ReadableStream<Uint8Array>, max: number): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error(`This attachment exceeds the ${Math.floor(max / 1024 / 1024)} MB processing limit.`);
      chunks.push(value);
    }
    if (!size) throw new Error("The attachment is empty.");
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** Store under the linked owner's identity using the same blobs as browser uploads. */
export async function storeMessagingAttachment(userId: number, file: InboundAttachment, body: ReadableStream<Uint8Array>): Promise<ChatAttachment> {
  const mime = file.mimeType.split(";", 1)[0].trim().toLowerCase();
  let name = attachmentName(file.name);
  let extension = path.extname(name).slice(1).toLowerCase();
  if ((!extension || extension === "bin") && MIME_EXTENSIONS[mime]) {
    extension = MIME_EXTENSIONS[mime];
    name = `${path.parse(name).name || "attachment"}.${extension}`;
  }
  const audio = audioAttachmentFormat(name) || (extension === "opus" ? "ogg" : null);
  const video = videoAttachmentFormat(name);
  const document = documentAttachmentFormat(name);
  if (audio) {
    const blob = await writeAudioBlob({ userId, format: audio, body });
    return { type: "audio", name, blobId: blob.blobId, format: audio, sizeBytes: blob.byteSize };
  }
  if (video) {
    const blob = await writeVideoBlob({ userId, format: video, body });
    return { type: "video", name, blobId: blob.blobId, format: video, sizeBytes: blob.byteSize };
  }
  if (document) {
    const blob = await writeDocumentBlob({ userId, format: document, body });
    const { readMessagingDocument } = await import("./read-document.ts");
    const reading = await readMessagingDocument(userId, blob.blobId, document, blob.path, name);
    return { type: "document", name, blobId: blob.blobId, format: document, sizeBytes: blob.byteSize, ...reading };
  }
  if (["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "tif", "tiff", "bmp", "avif"].includes(extension) || (mime.startsWith("image/") && extension !== "svg")) {
    const bytes = await readBounded(body, 32 * 1024 * 1024);
    // Keep small browser/vision formats intact; validate every image before dispatch.
    const metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata();
    const supported = ["jpeg", "png", "webp", "gif"].includes(metadata.format || "");
    const image = supported && bytes.length <= 8 * 1024 * 1024 ? bytes
      : await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const imageMime = image === bytes ? `image/${metadata.format}` : "image/jpeg";
    return { type: "image", name, sizeBytes: bytes.length, dataUrl: `data:${imageMime};base64,${image.toString("base64")}` };
  }
  const format = storedFileAttachmentFormat(name) || "bin";
  const blob = await writeStoredFileBlob({ userId, format, body });
  let text = `Original file attached: ${name}. Open the workspace copy with an appropriate reader to inspect its contents.`;
  if (storedFileIsText(format)) text = (await fs.readFile(blob.path, "utf8")).slice(0, 2 * 1024 * 1024);
  return { type: "text", name, blobId: blob.blobId, format, sizeBytes: blob.byteSize, text };
}

export async function prepareMessagingAttachments(input: {
  userId: number;
  hasMedia: boolean;
  files: readonly InboundAttachment[];
  open: (file: InboundAttachment) => Promise<AttachmentSource>;
}): Promise<ChatAttachment[]> {
  if (!input.files.length && input.hasMedia) throw new Error("The attachment could not be downloaded. Please send it again.");
  const attachments: ChatAttachment[] = [];
  for (const file of input.files) {
    const source = file.text !== undefined
      ? { body: new Blob([file.text]).stream(), dispose: () => undefined }
      : await input.open(file);
    try { attachments.push(await storeMessagingAttachment(input.userId, file, source.body)); }
    finally { source.dispose(); }
  }
  return attachments;
}
