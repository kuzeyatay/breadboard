import { attachmentReferenced } from "../storage/attachment-references.ts";
// Uploads remain user content, including unsent drafts. Explicit conversation
// deletion releases bytes only when no other indexed message owns the blob.

import type Database from "better-sqlite3";
import db from "../db.ts";
import { isAudioBlobId } from "../audio-attachments.ts";
import { removeAudioBlob } from "./audio-blob-store.ts";
import { messageAttachments } from "./uploads.ts";


/** Every audio blob id referenced by a message in one conversation. */
function conversationAudioBlobIds(
  conversationId: number,
  database: Database.Database,
): string[] {
  const rows = database
    .prepare(
      `SELECT metadata FROM conversation_message_reads
       WHERE conversation_id = ? AND metadata LIKE '%aud_%'`,
    )
    .all(conversationId) as Array<{ metadata: string | null }>;
  return rows.flatMap((row) =>
    messageAttachments(row.metadata).flatMap((attachment) =>
      attachment.type === "audio" ? [attachment.blobId] : [],
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
    if (isAudioBlobId(blobId) && !attachmentReferenced(database, blobId, conversationId) && removeAudioBlob({ userId, blobId })) removed += 1;
  }
  return removed;
}

/** Compatibility API: unsent uploads remain protected user content. */
export function sweepUnreferencedAudioBlobs(
  userId: number,
  database: Database.Database = db,
): number {
  // Unsent uploads are user content. Age and a bounded history sample are
  // not disposal authority; explicit chat deletion owns this lifecycle.
  return 0;
}
