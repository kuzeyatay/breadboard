import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { collectUploads, type UploadSourceRow } from "@/lib/conversations/uploads.ts";

export const dynamic = "force-dynamic";

const MAX_MESSAGES_SCANNED = 600;
const MAX_UPLOADS = 300;

/**
 * GET: everything this user has attached to a chat, newest first.
 *
 * Only the user's own conversations are scanned, and only the user half of a
 * turn carries attachments, so an assistant-produced file never appears here —
 * those are artifacts and have their own panel.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    requireEnabled();

    const rows = db
      .prepare(
        `SELECT m.id AS message_id, m.metadata AS metadata, m.created_at AS created_at,
                c.public_id AS conversation_public_id, c.title AS conversation_title,
                c.surface AS surface
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ?
           AND m.role = 'user'
           AND m.metadata IS NOT NULL
           AND (m.metadata LIKE '%"attachments"%' OR m.metadata LIKE '%"attachmentNames"%')
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT ${MAX_MESSAGES_SCANNED}`,
      )
      .all(userId) as UploadSourceRow[];

    return NextResponse.json({ uploads: collectUploads(rows, MAX_UPLOADS) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
