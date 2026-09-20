// Resolve original uploads from the authenticated conversation, never a
// model-supplied path, blob id, user id, or conversation id.
import fs from "node:fs";
import path from "node:path";
import db from "../db.ts";
import { messageAttachments } from "../conversations/uploads.ts";
import { findDocumentBlob } from "../conversations/document-blob-store.ts";
import { findStoredFileBlob } from "../conversations/stored-file-blob-store.ts";
import { findAudioBlob } from "../conversations/audio-blob-store.ts";
import { findVideoBlob } from "../conversations/video-blob-store.ts";
import { storedFileIsText } from "../stored-file-attachments.ts";
import { anydocFormatForExtension } from "../anydoc/formats.ts";
import { uploadLimitBytes } from "../ingest-upload.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "./run-store.ts";
import { getRuntimeSessionById } from "./runtime-store.ts";
import type { GardenSourceImportContext } from "./garden-source-import.ts";

export interface GardenAttachmentSource {
  file: File;
  kind: "pdf" | "document" | "image" | "audio" | "video";
}

export async function resolveGardenAttachment(
  context: GardenSourceImportContext,
  args: Record<string, unknown>,
  options: {
    roots?: { documents?: string; files?: string; audio?: string; video?: string };
  } = {},
): Promise<GardenAttachmentSource> {
  const database = db;
  if (!context.conversationId || !context.runtimeSessionId) {
    throw new Error("Importing an attachment requires an active signed-in conversation.");
  }
  const session = getRuntimeSessionById(context.runtimeSessionId);
  if (session?.conversation_id !== context.conversationId || session.user_id !== context.userId) {
    throw new Error("The active session does not belong to this conversation.");
  }
  const run = getActiveRuntimeRun(context.runtimeSessionId);
  const clientMessageId = run ? parseRuntimeRunDispatch(run).clientMessageId : null;
  const active = clientMessageId ? database.prepare(`
    SELECT m.id FROM conversation_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.id = ? AND c.user_id = ? AND m.client_message_id = ? AND m.role = 'user'
  `).get(context.conversationId, context.userId, clientMessageId) as { id: number } | undefined : null;
  if (!active) throw new Error("The active user message could not be found.");

  const name = args.attachmentName;
  const index = args.attachmentIndex;
  if (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 500)) {
    throw new Error("attachmentName must be the exact uploaded filename.");
  }
  if (index !== undefined && (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > 10)) {
    throw new Error("attachmentIndex must be an integer from 1 to 10.");
  }
  if (name !== undefined && index !== undefined) throw new Error("Use attachmentName or attachmentIndex, not both.");

  // A follow-up can refer to earlier uploads, but never future queued turns.
  const rows = database.prepare(`
    SELECT metadata FROM conversation_messages
    WHERE conversation_id = ? AND role = 'user' AND id <= ? AND metadata IS NOT NULL
    ORDER BY id DESC
  `).iterate(context.conversationId, active.id) as Iterable<{ metadata: string }>;
  let selected;
  for (const row of rows) {
    const attachments = messageAttachments(row.metadata).filter((item) => !item.context);
    if (!attachments.length) continue;
    if (typeof name === "string") {
      const matches = attachments.filter((item) => item.name.toLocaleLowerCase("en-US") === name.trim().toLocaleLowerCase("en-US"));
      if (!matches.length) continue;
      if (matches.length > 1) throw new Error("Several attachments have that name; use attachmentIndex.");
      selected = matches[0];
    } else {
      if (index === undefined && attachments.length !== 1) {
        throw new Error("There are multiple attachments; provide attachmentName or attachmentIndex for each import.");
      }
      selected = attachments[(index as number | undefined ?? 1) - 1];
      if (!selected) throw new Error("That attachment index does not exist in the latest upload message.");
    }
    break;
  }
  if (!selected) throw new Error("No matching attachment was found in this conversation.");
  if (selected.type === "model") throw new Error("3D model files cannot be ingested as Garden sources. Attach a document, image, audio, or video instead.");

  let blob: Blob;
  let extension: string;
  let kind: GardenAttachmentSource["kind"];
  if (selected.type === "image") {
    const match = /^data:(image\/(png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i.exec(selected.dataUrl);
    if (!match) throw new Error("Garden image ingestion supports PNG, JPEG and WebP. Attach one of these formats.");
    blob = new Blob([Buffer.from(match[3].replace(/\s/g, ""), "base64")], { type: match[1] });
    extension = match[2].toLowerCase();
    kind = "image";
  } else {
    if (!selected.blobId || !selected.format) throw new Error("This older attachment no longer has its original bytes. Attach it again.");
    const lookup = { userId: context.userId, blobId: selected.blobId };
    const stored = selected.type === "document" ? findDocumentBlob({ ...lookup, root: options.roots?.documents })
      : selected.type === "audio" ? findAudioBlob({ ...lookup, root: options.roots?.audio })
      : selected.type === "video" ? findVideoBlob({ ...lookup, root: options.roots?.video })
      : findStoredFileBlob({ ...lookup, root: options.roots?.files });
    if (!stored || stored.format !== selected.format) throw new Error("The attached file is no longer available to this user. Attach it again.");
    extension = stored.format === "bin" ? path.extname(selected.name).slice(1).toLowerCase() : stored.format;
    if (selected.type === "file" && !storedFileIsText(selected.format) &&
        selected.format !== "zip" && selected.format !== "mlx" && !anydocFormatForExtension(extension)) {
      throw new Error("This attachment format cannot be ingested as a Garden source.");
    }
    kind = selected.type === "audio" || selected.type === "video" ? selected.type : extension === "pdf" ? "pdf" : "document";
    if (kind !== "audio" && kind !== "video" && stored.byteSize > uploadLimitBytes()) throw new Error("The attachment exceeds the Garden upload limit.");
    blob = await fs.openAsBlob(stored.path);
  }
  if (!blob.size || (kind !== "audio" && kind !== "video" && blob.size > uploadLimitBytes())) throw new Error("The attachment is empty or exceeds the Garden upload limit.");
  // Preserve the display name, but derive its extension from the stored type.
  const stem = path.parse(selected.name.replaceAll("\\", "/")).name.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 90) || "attachment";
  return { file: new File([blob], `${stem}.${extension}`, { type: blob.type || "application/octet-stream" }), kind };
}
