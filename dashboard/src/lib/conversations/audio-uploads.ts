// Lifetime for the stored bytes of an attached song.
//
// The same rule the video sweep follows: the transcript is the authority. A
// track picked in the composer and then removed before send belongs to no
// message, and a deleted chat takes its attachments with it — so a stored file
// with no message pointing at it, old enough that it cannot still be a draft, is
// residue and is deleted.

import type Database from "better-sqlite3";
import db from "../db.ts";
import { isAudioBlobId } from "../audio-attachments.ts";
import { listAudioBlobs, removeAudioBlob } from "./audio-blob-store.ts";
import { messageAttachments } from "./uploads.ts";

/** How long an unsent blob is kept before it counts as abandoned. */
const SWEEP_AGE_HOURS = 24;
/** Upper bound on the work one opportunistic sweep may do. */
const SWEEP_CANDIDATE_LIMIT = 50;
const SWEEP_MESSAGE_LIMIT = 2_000;

/** Every audio blob id referenced by a message in one conversation. */
function conversationAudioBlobIds(
  conversationId: number,
  database: Database.Database,
): string[] {
  const rows = database
    .prepare(
      `SELECT metadata FROM conversation_messages
       WHERE conversation_id = ? AND metadata LIKE '%aud_%'`,
    )
    .all(conversationId) as Array<{ metadata: string | null }>;
  return rows.flatMap((row) =>
    messageAttachments(row.metadata).flatMap((attachment) =>
      attachment.type === "audio" ? [attachment.blobId] : [],
    ),
  );
}

/** Every audio blob id this user's recent messages still point at. */
function referencedAudioBlobIds(
  userId: number,
  database: Database.Database,
): Set<string> {
  const rows = database
    .prepare(
      `SELECT m.metadata AS metadata
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.metadata LIKE '%aud_%'
       ORDER BY m.id DESC
       LIMIT ${SWEEP_MESSAGE_LIMIT}`,
    )
    .all(userId) as Array<{ metadata: string | null }>;
  return new Set(
    rows.flatMap((row) =>
      messageAttachments(row.metadata).flatMap((attachment) =>
        attachment.type === "audio" ? [attachment.blobId] : [],
      ),
    ),
  );
}

/**
 * Drop the tracks a conversation owned. Called before the conversation row is
 * deleted, while its messages can still be read.
 */
export function removeConversationAudioBlobs(
  conversationId: number,
  userId: number,
  database: Database.Database = db,
): number {
  const ids = [...new Set(conversationAudioBlobIds(conversationId, database))];
  let removed = 0;
  for (const blobId of ids) {
    if (isAudioBlobId(blobId) && removeAudioBlob({ userId, blobId })) removed += 1;
  }
  return removed;
}

/**
 * Delete this user's aged tracks that no message refers to. Bounded on both
 * sides, so it stays cheap enough to run on the upload path.
 */
export function sweepUnreferencedAudioBlobs(
  userId: number,
  database: Database.Database = db,
): number {
  const cutoff = Date.now() - SWEEP_AGE_HOURS * 60 * 60 * 1000;
  const candidates = listAudioBlobs(userId)
    .filter((blob) => blob.modifiedAt < cutoff)
    .sort((left, right) => left.modifiedAt - right.modifiedAt)
    .slice(0, SWEEP_CANDIDATE_LIMIT);
  if (candidates.length === 0) return 0;

  const referenced = referencedAudioBlobIds(userId, database);
  let removed = 0;
  for (const blob of candidates) {
    if (referenced.has(blob.blobId)) continue;
    if (removeAudioBlob({ userId, blobId: blob.blobId })) removed += 1;
  }
  return removed;
}
