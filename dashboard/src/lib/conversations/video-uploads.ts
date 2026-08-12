// Lifetime for the stored bytes of an attached video.
//
// The blob store knows where bytes are and whose they are (the uploader is a
// directory level). What it cannot know is whether anyone still wants them: a
// video picked in the composer and then removed before send belongs to no
// message at all, and a chat that has been deleted takes its attachments with it.
//
// So the transcript is the authority here, exactly as it is for uploads.ts —
// a stored file with no message pointing at it, old enough that it cannot still
// be a draft, is residue and is deleted.

import type Database from "better-sqlite3";
import db from "../db.ts";
import { isVideoBlobId } from "../video-attachments.ts";
import { listVideoBlobs, removeVideoBlob } from "./video-blob-store.ts";
import { messageAttachments } from "./uploads.ts";

/** How long an unsent blob is kept before it counts as abandoned. */
const SWEEP_AGE_HOURS = 24;
/** Upper bound on the work one opportunistic sweep may do. */
const SWEEP_CANDIDATE_LIMIT = 50;
const SWEEP_MESSAGE_LIMIT = 2_000;

/** Every video blob id referenced by a message in one conversation. */
function conversationVideoBlobIds(
  conversationId: number,
  database: Database.Database,
): string[] {
  const rows = database
    .prepare(
      `SELECT metadata FROM conversation_messages
       WHERE conversation_id = ? AND metadata LIKE '%vid_%'`,
    )
    .all(conversationId) as Array<{ metadata: string | null }>;
  return rows.flatMap((row) =>
    messageAttachments(row.metadata).flatMap((attachment) =>
      attachment.type === "video" ? [attachment.blobId] : [],
    ),
  );
}

/** Every video blob id this user's recent messages still point at. */
function referencedVideoBlobIds(
  userId: number,
  database: Database.Database,
): Set<string> {
  const rows = database
    .prepare(
      `SELECT m.metadata AS metadata
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.metadata LIKE '%vid_%'
       ORDER BY m.id DESC
       LIMIT ${SWEEP_MESSAGE_LIMIT}`,
    )
    .all(userId) as Array<{ metadata: string | null }>;
  return new Set(
    rows.flatMap((row) =>
      messageAttachments(row.metadata).flatMap((attachment) =>
        attachment.type === "video" ? [attachment.blobId] : [],
      ),
    ),
  );
}

/**
 * Drop the videos a conversation owned. Called before the conversation row is
 * deleted, while its messages can still be read.
 */
export function removeConversationVideoBlobs(
  conversationId: number,
  userId: number,
  database: Database.Database = db,
): number {
  const ids = [...new Set(conversationVideoBlobIds(conversationId, database))];
  let removed = 0;
  for (const blobId of ids) {
    if (isVideoBlobId(blobId) && removeVideoBlob({ userId, blobId })) removed += 1;
  }
  return removed;
}

/**
 * Delete this user's aged videos that no message refers to — the residue of an
 * attachment that was picked and then removed, or a draft never sent.
 *
 * Bounded on both sides: at most `SWEEP_CANDIDATE_LIMIT` files are considered
 * and at most `SWEEP_MESSAGE_LIMIT` messages are read, so this stays cheap
 * enough to run on the upload path.
 */
export function sweepUnreferencedVideoBlobs(
  userId: number,
  database: Database.Database = db,
): number {
  const cutoff = Date.now() - SWEEP_AGE_HOURS * 60 * 60 * 1000;
  const candidates = listVideoBlobs(userId)
    .filter((blob) => blob.modifiedAt < cutoff)
    .sort((left, right) => left.modifiedAt - right.modifiedAt)
    .slice(0, SWEEP_CANDIDATE_LIMIT);
  if (candidates.length === 0) return 0;

  const referenced = referencedVideoBlobIds(userId, database);
  let removed = 0;
  for (const blob of candidates) {
    if (referenced.has(blob.blobId)) continue;
    if (removeVideoBlob({ userId, blobId: blob.blobId })) removed += 1;
  }
  return removed;
}
