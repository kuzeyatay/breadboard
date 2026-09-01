// Adopt an original file attached to the active user turn as a durable
// artifact. The transcript supplies authority and identity; the bytes stay in
// their user-scoped blob store until this service copies them into the artifact
// store. This keeps `artifact_import` as the single import primitive while
// avoiding invented workspace paths and lossy reconstruction from prompt text.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import db from "../db.ts";
import { messageAttachments } from "../conversations/uploads.ts";
import { findStoredFileBlob } from "../conversations/stored-file-blob-store.ts";
import { findDocumentBlob } from "../conversations/document-blob-store.ts";
import { findAudioBlob } from "../conversations/audio-blob-store.ts";
import { findVideoBlob } from "../conversations/video-blob-store.ts";
import { readModelBlob } from "../conversations/model-blob-store.ts";
import { STORED_FILE_ATTACHMENT_FORMATS } from "../stored-file-attachments.ts";
import type { ChatMessageAttachment } from "../chat-attachments.ts";
import type { ArtifactKind } from "./artifact-types.ts";
import {
  ArtifactStoreError,
  createImportedArtifact,
  type CreateImportedArtifactInput,
} from "./artifact-store.ts";

type UploadAttachment = Exclude<ChatMessageAttachment, { type: "product" }>;

export interface CreateArtifactFromUploadInput extends Omit<
  CreateImportedArtifactInput,
  "authorizedRoot" | "filePath" | "kind" | "title" | "filename" | "scrubProvenance"
> {
  clientMessageId: string;
  attachmentName?: string;
  /** One-based position among uploaded files in the active user message. */
  attachmentIndex?: number;
  requestedKind?: ArtifactKind;
  title?: string;
  attachmentStorageRoots?: {
    files?: string;
    documents?: string;
    audio?: string;
    video?: string;
    models?: string;
  };
}

interface SelectedUpload {
  attachment: UploadAttachment;
  index: number;
  messageId: number;
}

function uploadTitle(name: string): string {
  return path.parse(path.basename(name)).name.trim().slice(0, 240) || "Uploaded file";
}

function selectUpload(input: CreateArtifactFromUploadInput): SelectedUpload {
  const database = input.database ?? db;
  const row = database.prepare(`
    SELECT m.id, m.metadata
    FROM conversation_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id = ?
      AND c.user_id = ?
      AND m.client_message_id = ?
      AND m.role = 'user'
    ORDER BY m.id DESC
    LIMIT 1
  `).get(input.conversationId, input.userId, input.clientMessageId) as {
    id: number;
    metadata: string | null;
  } | undefined;
  if (!row) {
    throw new ArtifactStoreError(
      404,
      "artifact_upload_message_not_found",
      "The active user message could not be found.",
    );
  }

  const attachments = messageAttachments(row.metadata);
  if (attachments.length === 0) {
    throw new ArtifactStoreError(
      404,
      "artifact_upload_required",
      "The active user message has no uploaded files to import.",
    );
  }

  let index = -1;
  if (input.attachmentName) {
    const wanted = input.attachmentName.trim().toLocaleLowerCase("en-US");
    const matches = attachments
      .map((attachment, candidateIndex) => ({ attachment, candidateIndex }))
      .filter(({ attachment }) => attachment.name.toLocaleLowerCase("en-US") === wanted);
    if (matches.length > 1) {
      throw new ArtifactStoreError(
        409,
        "artifact_upload_ambiguous",
        `More than one upload is named ${JSON.stringify(input.attachmentName)}; use attachmentIndex.`,
      );
    }
    index = matches[0]?.candidateIndex ?? -1;
  } else if (input.attachmentIndex !== undefined) {
    index = input.attachmentIndex - 1;
  } else if (attachments.length === 1) {
    index = 0;
  } else {
    throw new ArtifactStoreError(
      409,
      "artifact_upload_ambiguous",
      "The message has multiple uploads; provide attachmentName or attachmentIndex.",
    );
  }

  const attachment = attachments[index];
  if (!attachment) {
    throw new ArtifactStoreError(
      404,
      "artifact_upload_not_found",
      input.attachmentName
        ? `No current-turn upload is named ${JSON.stringify(input.attachmentName)}.`
        : "That attachment index does not exist in the active user message.",
    );
  }
  return { attachment, index, messageId: row.id };
}

function dataUrlBytes(dataUrl: string, name: string): { buffer: Buffer; extension: string } {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) {
    throw new ArtifactStoreError(
      422,
      "artifact_upload_unavailable",
      "The uploaded image bytes are not available in a supported format.",
    );
  }
  return {
    buffer: Buffer.from(match[2].replace(/\s+/g, ""), "base64"),
    extension: match[1].toLowerCase() === "image/jpeg"
      ? path.extname(name).toLowerCase() === ".jpeg" ? ".jpeg" : ".jpg"
      : `.${match[1].slice(6).toLowerCase()}`,
  };
}

function sourceForUpload(input: {
  attachment: UploadAttachment;
  userId: number;
  directory: string;
  roots?: CreateArtifactFromUploadInput["attachmentStorageRoots"];
}): { filePath: string; kind: ArtifactKind } {
  const { attachment } = input;
  let sourcePath: string | null = null;
  let extension = "";
  let buffer: Buffer | null = null;
  let kind: ArtifactKind;

  if (attachment.type === "file") {
    if (!attachment.blobId || !attachment.format) {
      throw new ArtifactStoreError(
        410,
        "artifact_upload_unavailable",
        "This older upload retained only its filename, not its original bytes.",
      );
    }
    const stored = findStoredFileBlob({ userId: input.userId, blobId: attachment.blobId, root: input.roots?.files });
    if (!stored || stored.format !== attachment.format) {
      throw new ArtifactStoreError(404, "artifact_upload_unavailable", "The uploaded file is no longer available.");
    }
    sourcePath = stored.path;
    extension = `.${stored.format}`;
    kind = STORED_FILE_ATTACHMENT_FORMATS[stored.format].artifactKind;
  } else if (attachment.type === "image") {
    const decoded = dataUrlBytes(attachment.dataUrl, attachment.name);
    buffer = decoded.buffer;
    extension = decoded.extension;
    kind = "image";
  } else if (attachment.type === "document") {
    const stored = findDocumentBlob({ userId: input.userId, blobId: attachment.blobId, root: input.roots?.documents });
    if (!stored || stored.format !== attachment.format) {
      throw new ArtifactStoreError(404, "artifact_upload_unavailable", "The uploaded document is no longer available.");
    }
    sourcePath = stored.path;
    extension = `.${stored.format}`;
    kind = stored.format === "pdf"
      ? "pdf"
      : stored.format === "docx" || stored.format === "odt"
        ? "document"
        : stored.format === "pptx" || stored.format === "odp"
          ? "presentation"
          : "spreadsheet";
  } else if (attachment.type === "audio") {
    const stored = findAudioBlob({ userId: input.userId, blobId: attachment.blobId, root: input.roots?.audio });
    if (!stored || stored.format !== attachment.format) {
      throw new ArtifactStoreError(404, "artifact_upload_unavailable", "The uploaded audio is no longer available.");
    }
    sourcePath = stored.path;
    extension = `.${stored.format}`;
    kind = "audio";
  } else if (attachment.type === "video") {
    const stored = findVideoBlob({ userId: input.userId, blobId: attachment.blobId, root: input.roots?.video });
    if (!stored || stored.format !== attachment.format) {
      throw new ArtifactStoreError(404, "artifact_upload_unavailable", "The uploaded video is no longer available.");
    }
    sourcePath = stored.path;
    extension = `.${stored.format}`;
    kind = "video";
  } else {
    try {
      buffer = readModelBlob({ blobId: attachment.blobId, format: attachment.format, storageRoot: input.roots?.models });
    } catch {
      throw new ArtifactStoreError(404, "artifact_upload_unavailable", "The uploaded 3D model is no longer available.");
    }
    extension = `.${attachment.format}`;
    kind = "model";
  }

  const staged = path.join(input.directory, `upload${extension}`);
  if (buffer) fs.writeFileSync(staged, buffer);
  else fs.copyFileSync(sourcePath!, staged);
  return { filePath: staged, kind };
}

export async function createArtifactFromUpload(
  input: CreateArtifactFromUploadInput,
) {
  if (
    input.attachmentIndex !== undefined &&
    (!Number.isInteger(input.attachmentIndex) || input.attachmentIndex < 1 || input.attachmentIndex > 10)
  ) {
    throw new ArtifactStoreError(
      400,
      "artifact_attachment_index_invalid",
      "attachmentIndex must be an integer from 1 to 10.",
    );
  }
  const selected = selectUpload(input);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-artifact-upload-"));
  try {
    const source = sourceForUpload({
      attachment: selected.attachment,
      userId: input.userId,
      directory: temporaryRoot,
      roots: input.attachmentStorageRoots,
    });
    if (input.requestedKind && input.requestedKind !== source.kind) {
      throw new ArtifactStoreError(
        422,
        "artifact_upload_kind_mismatch",
        `The upload is a ${source.kind} artifact, not ${input.requestedKind}.`,
      );
    }
    return await createImportedArtifact({
      ...input,
      title: input.title?.trim().slice(0, 240) || uploadTitle(selected.attachment.name),
      filename: selected.attachment.name,
      kind: source.kind,
      authorizedRoot: temporaryRoot,
      filePath: source.filePath,
      scrubProvenance: false,
      metadata: {
        ...(input.metadata ?? {}),
        importedFromUpload: true,
        uploadMessageId: selected.messageId,
        uploadIndex: selected.index + 1,
        uploadName: selected.attachment.name,
      },
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
