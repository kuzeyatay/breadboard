// Lifetime management for exact plain/source/archive uploads. The transcript is
// the authority: deleting a conversation removes its referenced blobs, and an
// aged blob no message ever adopted is an abandoned composer draft.

import type Database from "better-sqlite3";
import db from "../db.ts";
import { isStoredFileBlobId } from "../stored-file-attachments.ts";
import { listStoredFileBlobs, removeStoredFileBlob } from "./stored-file-blob-store.ts";
import { messageAttachments } from "./uploads.ts";

const SWEEP_AGE_HOURS = 24;
const SWEEP_CANDIDATE_LIMIT = 50;
const SWEEP_MESSAGE_LIMIT = 2_000;

function conversationBlobIds(
  conversationId: number,
  database: Database.Database,
): string[] {
  const rows = database.prepare(`
    SELECT metadata FROM conversation_messages
    WHERE conversation_id = ? AND metadata LIKE '%fil_%'
  `).all(conversationId) as Array<{ metadata: string | null }>;
  return rows.flatMap((row) =>
    messageAttachments(row.metadata).flatMap((attachment) =>
      attachment.type === "file" && attachment.blobId ? [attachment.blobId] : [],
    ),
  );
}

function referencedBlobIds(userId: number, database: Database.Database): Set<string> {
  const rows = database.prepare(`
    SELECT m.metadata AS metadata
    FROM conversation_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND m.metadata LIKE '%fil_%'
    ORDER BY m.id DESC
    LIMIT ${SWEEP_MESSAGE_LIMIT}
  `).all(userId) as Array<{ metadata: string | null }>;
  return new Set(rows.flatMap((row) =>
    messageAttachments(row.metadata).flatMap((attachment) =>
      attachment.type === "file" && attachment.blobId ? [attachment.blobId] : [],
    ),
  ));
}

export function removeConversationStoredFileBlobs(
  conversationId: number,
  userId: number,
  database: Database.Database = db,
): number {
  let removed = 0;
  for (const blobId of new Set(conversationBlobIds(conversationId, database))) {
    if (isStoredFileBlobId(blobId) && removeStoredFileBlob({ userId, blobId })) removed += 1;
  }
  return removed;
}

export function sweepUnreferencedStoredFileBlobs(
  userId: number,
  database: Database.Database = db,
): number {
  const cutoff = Date.now() - SWEEP_AGE_HOURS * 60 * 60 * 1_000;
  const candidates = listStoredFileBlobs(userId)
    .filter((blob) => blob.modifiedAt < cutoff)
    .sort((left, right) => left.modifiedAt - right.modifiedAt)
    .slice(0, SWEEP_CANDIDATE_LIMIT);
  if (candidates.length === 0) return 0;
  const referenced = referencedBlobIds(userId, database);
  let removed = 0;
  for (const blob of candidates) {
    if (!referenced.has(blob.blobId) && removeStoredFileBlob({ userId, blobId: blob.blobId })) {
      removed += 1;
    }
  }
  return removed;
}
