// Ownership and lifetime for the stored bytes of an attached 3D model.
//
// The blob store (model-blob-store.ts) knows where bytes are; this knows whose
// they are. The split matters because a model is viewable before it is sent —
// the user attaches a mesh, then wants to look at it before pressing send — and
// at that moment no message references it yet, so the message join every other
// attachment is authorized through does not exist.
//
// Lifetime: a blob dies with the conversation that referenced it. Blobs that
// were attached and then never sent have no owning message at all, so they are
// swept once they are old enough to be certain they were abandoned.

import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  isModelAttachmentFormat,
  type ModelAttachmentFormat,
} from "../model-attachments.ts";
import { removeModelBlob, type StoredModelBlob } from "./model-blob-store.ts";
import { messageAttachments } from "./uploads.ts";

/** How long an unsent blob is kept before it counts as abandoned. */
const SWEEP_AGE_HOURS = 24;
/** Upper bound on the work one opportunistic sweep may do. */
const SWEEP_CANDIDATE_LIMIT = 50;
const SWEEP_MESSAGE_LIMIT = 2_000;

export interface ModelBlobRecord {
  blobId: string;
  userId: number;
  format: ModelAttachmentFormat;
  filename: string;
  byteSize: number;
  sha256: string;
}

interface ModelBlobRow {
  blob_id: string;
  user_id: number;
  format: string;
  filename: string;
  byte_size: number;
  sha256: string;
}

function toRecord(row: ModelBlobRow | undefined): ModelBlobRecord | null {
  if (!row || !isModelAttachmentFormat(row.format)) return null;
  return {
    blobId: row.blob_id,
    userId: row.user_id,
    format: row.format,
    filename: row.filename,
    byteSize: row.byte_size,
    sha256: row.sha256,
  };
}

export function recordModelBlob(
  input: StoredModelBlob & { userId: number; filename: string },
  database: Database.Database = db,
): void {
  database
    .prepare(
      `INSERT OR REPLACE INTO chat_model_blobs
         (blob_id, user_id, format, filename, byte_size, sha256)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.blobId,
      input.userId,
      input.format,
      input.filename.slice(0, 240),
      input.byteSize,
      input.sha256,
    );
}

/** The blob, but only if this user uploaded it. Null reads as "not found". */
export function getModelBlobForUser(
  blobId: string,
  userId: number,
  database: Database.Database = db,
): ModelBlobRecord | null {
  const row = database
    .prepare("SELECT * FROM chat_model_blobs WHERE blob_id = ? AND user_id = ?")
    .get(blobId, userId) as ModelBlobRow | undefined;
  return toRecord(row);
}

function forgetBlobs(
  blobs: readonly ModelBlobRecord[],
  database: Database.Database,
): number {
  if (blobs.length === 0) return 0;
  const remove = database.prepare("DELETE FROM chat_model_blobs WHERE blob_id = ?");
  for (const blob of blobs) {
    removeModelBlob(blob.blobId, blob.format);
    remove.run(blob.blobId);
  }
  return blobs.length;
}

/** Every model blob id referenced by a message in one conversation. */
function conversationBlobIds(
  conversationId: number,
  database: Database.Database,
): string[] {
  const rows = database
    .prepare(
      `SELECT metadata FROM conversation_messages
       WHERE conversation_id = ? AND metadata LIKE '%mdl_%'`,
    )
    .all(conversationId) as Array<{ metadata: string | null }>;
  return rows.flatMap((row) =>
    messageAttachments(row.metadata).flatMap((attachment) =>
      attachment.type === "model" ? [attachment.blobId] : [],
    ),
  );
}

/**
 * Drop the blobs a conversation owned. Called before the conversation row is
 * deleted, while its messages can still be read.
 */
export function removeConversationModelBlobs(
  conversationId: number,
  database: Database.Database = db,
): number {
  const ids = [...new Set(conversationBlobIds(conversationId, database))];
  if (ids.length === 0) return 0;
  const select = database.prepare("SELECT * FROM chat_model_blobs WHERE blob_id = ?");
  const blobs = ids.flatMap((blobId) => {
    const record = toRecord(select.get(blobId) as ModelBlobRow | undefined);
    return record ? [record] : [];
  });
  return forgetBlobs(blobs, database);
}

/**
 * Delete this user's aged blobs that no message refers to — the residue of an
 * attachment that was picked and then removed, or a draft never sent.
 *
 * Bounded on both sides: at most `SWEEP_CANDIDATE_LIMIT` blobs are considered
 * and at most `SWEEP_MESSAGE_LIMIT` messages are read, so this stays cheap
 * enough to run on the upload path.
 */
export function sweepUnreferencedModelBlobs(
  userId: number,
  database: Database.Database = db,
): number {
  const candidates = (
    database
      .prepare(
        `SELECT * FROM chat_model_blobs
         WHERE user_id = ?
           AND created_at < datetime('now', ?)
         ORDER BY created_at
         LIMIT ${SWEEP_CANDIDATE_LIMIT}`,
      )
      .all(userId, `-${SWEEP_AGE_HOURS} hours`) as ModelBlobRow[]
  ).flatMap((row) => {
    const record = toRecord(row);
    return record ? [record] : [];
  });
  if (candidates.length === 0) return 0;

  const referenced = new Set(
    (
      database
        .prepare(
          `SELECT m.metadata AS metadata
           FROM conversation_messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE c.user_id = ? AND m.metadata LIKE '%mdl_%'
           ORDER BY m.id DESC
           LIMIT ${SWEEP_MESSAGE_LIMIT}`,
        )
        .all(userId) as Array<{ metadata: string | null }>
    ).flatMap((row) =>
      messageAttachments(row.metadata).flatMap((attachment) =>
        attachment.type === "model" ? [attachment.blobId] : [],
      ),
    ),
  );

  return forgetBlobs(
    candidates.filter((blob) => !referenced.has(blob.blobId)),
    database,
  );
}
