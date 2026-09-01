import { NextResponse } from "next/server";

import db from "@/lib/db";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";
import {
  searchConversations,
  type ConversationSearchCandidate,
  type ConversationSearchMessage,
} from "@/lib/conversations/search.ts";
import { chatReferenceKey } from "@/lib/conversations/chat-reference.ts";

export const dynamic = "force-dynamic";

const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES_PER_CONVERSATION = 60;

interface ReferenceConversationRow {
  id: number;
  public_id: string;
  title: string;
  surface: HermesSurface;
  updated_at: string;
  pinned_at: string | null;
}

function surfaceLabel(surface: HermesSurface): string {
  if (surface === "garden_chat") return "Garden";
  if (surface === "quartz_ai") return "Page";
  return "Terminal";
}

function currentConversationId(input: {
  userId: number;
  surface: HermesSurface | null;
  sessionId: string;
}): number | null {
  if (!input.sessionId) return null;
  if (input.sessionId.startsWith("conv_")) {
    const row = db.prepare(
      "SELECT id FROM conversations WHERE public_id = ? AND user_id = ?",
    ).get(input.sessionId, input.userId) as { id: number } | undefined;
    return row?.id ?? null;
  }
  const numericId = Number(input.sessionId);
  if (!Number.isSafeInteger(numericId) || numericId < 1) return null;
  const legacyColumn = input.surface === "garden_chat"
    ? "legacy_chat_session_id"
    : "legacy_runtime_session_id";
  const row = db.prepare(
    `SELECT id FROM conversations WHERE ${legacyColumn} = ? AND user_id = ?`,
  ).get(numericId, input.userId) as { id: number } | undefined;
  return row?.id ?? null;
}

function snippet(messages: readonly ConversationSearchMessage[]): string {
  const message = messages.find((item) => item.role === "user" && item.content.trim())
    ?? messages.find((item) => item.content.trim());
  if (!message) return "";
  const value = message.content.replace(/\s+/g, " ").trim();
  return value.length > 160 ? `${value.slice(0, 160)}…` : value;
}

/**
 * Searchable, cross-surface chat inventory for the capability palette. Only
 * saved chats owned by the signed-in user are returned; temporary and private
 * agent-room conversations never become reference candidates.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 300);
    const surfaceValue = url.searchParams.get("surface");
    const surface = surfaceValue && (HERMES_SURFACES as readonly string[]).includes(surfaceValue)
      ? surfaceValue as HermesSurface
      : null;
    const currentId = currentConversationId({
      userId,
      surface,
      sessionId: (url.searchParams.get("sessionId") ?? "").trim(),
    });

    const rows = db.prepare(`
      SELECT id, public_id, title, surface, updated_at, pinned_at
      FROM conversations
      WHERE user_id = ? AND temporary = 0 AND buzz_room_id IS NULL
        ${currentId === null ? "" : "AND id <> ?"}
        AND EXISTS (
          SELECT 1 FROM conversation_messages message
          WHERE message.conversation_id = conversations.id
            AND message.status <> 'pending' AND trim(message.content) <> ''
        )
      ORDER BY updated_at DESC, id DESC
      LIMIT ${MAX_CONVERSATIONS}
    `).all(...(currentId === null ? [userId] : [userId, currentId])) as ReferenceConversationRow[];

    const readMessages = db.prepare(`
      SELECT role, substr(content, 1, 2000) AS content
      FROM conversation_messages
      WHERE conversation_id = ? AND status <> 'pending' AND trim(content) <> ''
      ORDER BY order_index DESC
      LIMIT ?
    `);
    const messagesById = new Map<number, ConversationSearchMessage[]>();
    const candidates: ConversationSearchCandidate[] = rows.map((row) => {
      const messages = (
        readMessages.all(row.id, MAX_MESSAGES_PER_CONVERSATION) as ConversationSearchMessage[]
      ).reverse();
      messagesById.set(row.id, messages);
      return {
        id: row.public_id,
        title: row.title,
        updatedAt: row.updated_at,
        pinned: row.pinned_at !== null,
        messages,
      };
    });
    const hits = query
      ? searchConversations(candidates, query, { limit: 40 })
      : candidates.slice(0, 40).map((candidate) => ({
          ...candidate,
          score: 0,
          matchedOn: "title" as const,
          snippet: snippet(candidate.messages),
        }));
    const rowsByPublicId = new Map(rows.map((row) => [row.public_id, row]));

    return NextResponse.json({
      results: hits.flatMap((hit) => {
        const row = rowsByPublicId.get(hit.id);
        if (!row) return [];
        return [{
          id: row.public_id,
          title: row.title,
          surface: row.surface,
          surfaceLabel: surfaceLabel(row.surface),
          updatedAt: row.updated_at,
          snippet: hit.snippet || snippet(messagesById.get(row.id) ?? []),
          token: `reference:${chatReferenceKey({
            title: row.title,
            publicId: row.public_id,
          })}`,
        }];
      }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
