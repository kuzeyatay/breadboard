import { attachmentReferenced } from "../storage/attachment-references.ts";
// Uploads remain user content, including unsent drafts. Explicit conversation
// deletion releases bytes only when no other indexed message owns the blob.

import type Database from "better-sqlite3";
import db from "../db.ts";
import { isStoredFileBlobId } from "../stored-file-attachments.ts";
import { removeStoredFileBlob } from "./stored-file-blob-store.ts";
import { messageAttachments } from "./uploads.ts";


function conversationBlobIds(
  conversationId: number,
  database: Database.Database,
): string[] {
  const rows = database.prepare(`
    SELECT metadata FROM conversation_message_reads
    WHERE conversation_id = ? AND metadata LIKE '%fil_%'
  `).all(conversationId) as Array<{ metadata: string | null }>;
  return rows.flatMap((row) =>
    messageAttachments(row.metadata).flatMap((attachment) =>
      attachment.type === "file" && attachment.blobId ? [attachment.blobId] : [],
    ),
  );
}


export function removeConversationStoredFileBlobs(
  conversationId: number,
  userId: number,
  database: Database.Database = db,
): number {
  let removed = 0;
  for (const blobId of new Set(conversationBlobIds(conversationId, database))) {
    if (isStoredFileBlobId(blobId) && !attachmentReferenced(database, blobId, conversationId) && removeStoredFileBlob({ userId, blobId })) removed += 1;
  }
  return removed;
}

export function sweepUnreferencedStoredFileBlobs(
  userId: number,
  database: Database.Database = db,
): number {
  // Unsent uploads are user content. Age and a bounded history sample are
  // not disposal authority; explicit chat deletion owns this lifecycle.
  return 0;
}
