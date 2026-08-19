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
 *
 * `gardenSlug` narrows the scan to the chats of one garden, which is what the
 * Garden's own Uploads panel asks for. Without it the answer is everything the
 * user has ever attached, across every garden and the Terminal — which is what
 * the Terminal's panel wants.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();

    const gardenSlug = (new URL(request.url).searchParams.get("gardenSlug") ?? "").trim();
    let clusterId: number | null = null;
    if (gardenSlug) {
      const cluster = db
        .prepare("SELECT id, user_id, chat_accessible FROM clusters WHERE slug = ?")
        .get(gardenSlug) as
        | { id: number; user_id: number; chat_accessible: number }
        | undefined;
      if (!cluster || (cluster.user_id !== userId && cluster.chat_accessible !== 1)) {
        return NextResponse.json({ uploads: [] });
      }
      clusterId = cluster.id;
    }

    const rows = db
      .prepare(
        `SELECT m.id AS message_id, m.metadata AS metadata, m.created_at AS created_at,
                c.public_id AS conversation_public_id, c.title AS conversation_title,
                c.surface AS surface, c.legacy_chat_session_id AS legacy_chat_session_id
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ?
           AND m.role = 'user'
           AND m.metadata IS NOT NULL
           AND (m.metadata LIKE '%"attachments"%' OR m.metadata LIKE '%"attachmentNames"%')
           ${clusterId === null ? "" : "AND c.default_garden_id = ?"}
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT ${MAX_MESSAGES_SCANNED}`,
      )
      .all(...(clusterId === null ? [userId] : [userId, clusterId])) as UploadSourceRow[];

    return NextResponse.json({ uploads: collectUploads(rows, MAX_UPLOADS) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
