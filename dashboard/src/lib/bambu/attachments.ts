import fs from "node:fs/promises";
import db from "../db.ts";
import { collectUploads, messageAttachments, parseUploadId, type UploadSourceRow } from "../conversations/uploads.ts";
import { readModelBlob } from "../conversations/model-blob-store.ts";
import { artifactFile, getArtifactForUser } from "../hermes/artifact-store.ts";
import { bambuService } from "./server.ts";
import { fail, type PrintJob } from "./types.ts";
import { MAX_FILE_BYTES } from "./inspection.ts";
export function slicedAttachments(job: PrintJob) {
  const rows = db.prepare(`SELECT m.id AS message_id, m.metadata, m.created_at, c.public_id AS conversation_public_id, c.title AS conversation_title, c.surface
    FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND c.public_id = ? AND m.role = 'user' ORDER BY m.id DESC LIMIT 100`).all(job.scope.userId, job.scope.conversationPublicId) as UploadSourceRow[];
  return collectUploads(rows, 100).filter(item => /\.gcode\.3mf$/i.test(item.name) && item.hasContent).map(item => ({ id: item.id, name: item.name }));
}
export async function stageAttachment(job: PrintJob, value: { uploadId?: unknown; artifactId?: unknown }) {
  let bytes: Buffer, name: string;
  if (typeof value.artifactId === "string") {
    const artifact = getArtifactForUser({ artifactId: value.artifactId, userId: job.scope.userId, conversationPublicId: job.scope.conversationPublicId });
    const file = artifactFile({ artifact, version: artifact.current_version, purpose: "download" });
    if ((await fs.stat(file.path)).size > MAX_FILE_BYTES) fail("The attached file exceeds 128 MiB.", "archive_size", 400);
    bytes = await fs.readFile(file.path); name = file.filename;
  } else {
    const parsed = typeof value.uploadId === "string" ? parseUploadId(value.uploadId) : null;
    if (!parsed) fail("Choose an authorized sliced attachment.", "attachment_required", 400);
    const row = db.prepare(`SELECT m.metadata FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = ? AND m.role = 'user' AND c.user_id = ? AND c.public_id = ?`).get(parsed.messageId, job.scope.userId, job.scope.conversationPublicId) as { metadata: string | null } | undefined;
    if (!row) fail("Attachment not found in this conversation.", "attachment_not_found", 404);
    const attachment = messageAttachments(row.metadata)[parsed.index];
    if (!attachment || attachment.type !== "model" || attachment.format !== "3mf") fail("Choose a retained .gcode.3mf model attachment.", "unsupported_attachment", 400);
    bytes = readModelBlob({ blobId: attachment.blobId, format: attachment.format }); name = attachment.name;
  }
  return bambuService().stage(job.id, job.scope.userId, job.scope.conversationPublicId, job.revision, bytes, name);
}
