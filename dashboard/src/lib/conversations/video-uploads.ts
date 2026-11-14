import { attachmentReferenced } from "../storage/attachment-references.ts";
// Uploads remain user content, including unsent drafts. Explicit conversation
// deletion releases bytes only when no other indexed message owns the blob.

import type Database from "better-sqlite3";
import db from "../db.ts";
import { isVideoBlobId } from "../video-attachments.ts";
import { removeVideoBlob } from "./video-blob-store.ts";
import { messageAttachments } from "./uploads.ts";


/** Every video blob id referenced by a message in one conversation. */
function conversationVideoBlobIds(
  conversationId: number,
  database: Database.Database,
): string[] {
  const rows = database
    .prepare(
      `SELECT metadata FROM conversation_message_reads
       WHERE conversation_id = ? AND metadata LIKE '%vid_%'`,
    )
    .all(conversationId) as Array<{ metadata: string | null }>;
  return rows.flatMap((row) =>
    messageAttachments(row.metadata).flatMap((attachment) =>
      attachment.type === "video" ? [attachment.blobId] : [],
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
    if (isVideoBlobId(blobId) && !attachmentReferenced(database, blobId, conversationId) && removeVideoBlob({ userId, blobId })) removed += 1;
  }
  return removed;
}

/** Compatibility API: unsent uploads remain protected user content. */
export function sweepUnreferencedVideoBlobs(
  userId: number,
  database: Database.Database = db,
): number {
  // Unsent uploads are user content. Age and a bounded history sample are
  // not disposal authority; explicit chat deletion owns this lifecycle.
  return 0;
}
