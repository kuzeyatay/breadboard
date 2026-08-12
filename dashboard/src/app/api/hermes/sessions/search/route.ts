import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import {
  searchConversations,
  type ConversationSearchCandidate,
  type ConversationSearchMessage,
} from "@/lib/conversations/search.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";

export const dynamic = "force-dynamic";

// Search reads the transcript, so it stays bounded on both axes: how many
// chats are considered and how much of each is scanned.
const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES_PER_CONVERSATION = 60;

interface ConversationRow {
  id: number;
  public_id: string;
  title: string;
  updated_at: string;
  pinned_at: string | null;
}

/**
 * GET: find past chats by word or by description.
 *
 * The ranking lives in lib/conversations/search.ts; this route only decides
 * whose chats may be read. A conversation is never returned across users, and
 * the surface filter keeps a Terminal search out of Garden transcripts.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 300);
    const surfaceParam = url.searchParams.get("surface");
    const surface =
      surfaceParam && (HERMES_SURFACES as readonly string[]).includes(surfaceParam)
        ? (surfaceParam as HermesSurface)
        : null;
    if (!query) return NextResponse.json({ results: [] });

    const conversations = db
      .prepare(
        `SELECT id, public_id, title, updated_at, pinned_at
         FROM conversations
         WHERE user_id = ?${surface ? " AND surface = ?" : ""}
         ORDER BY updated_at DESC, id DESC
         LIMIT ${MAX_CONVERSATIONS}`,
      )
      .all(...(surface ? [userId, surface] : [userId])) as ConversationRow[];

    const readMessages = db.prepare(
      `SELECT role, substr(content, 1, 2000) AS content
       FROM conversation_messages
       WHERE conversation_id = ? AND status <> 'pending' AND content <> ''
       ORDER BY order_index DESC
       LIMIT ?`,
    );

    const candidates: ConversationSearchCandidate[] = conversations.map((row) => ({
      id: row.public_id,
      title: row.title,
      updatedAt: row.updated_at,
      pinned: row.pinned_at !== null,
      messages: (
        readMessages.all(row.id, MAX_MESSAGES_PER_CONVERSATION) as ConversationSearchMessage[]
      ).reverse(),
    }));

    return NextResponse.json({
      results: searchConversations(candidates, query, { limit: 25 }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
