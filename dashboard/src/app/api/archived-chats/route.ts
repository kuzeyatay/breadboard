import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { listArchivedConversationsForUser } from "@/lib/conversations/store";
import { conversationOrigin } from "@/lib/hermes/session-surface";
import { apiErrorResponse } from "@/lib/hermes/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const gardenSlug = new URL(request.url).searchParams.get("gardenSlug")?.trim();
    const chats = listArchivedConversationsForUser(userId, gardenSlug).map((chat) => ({
      id: chat.public_id,
      chatId: gardenSlug ? String(chat.legacy_chat_session_id) : chat.public_id,
      title: chat.title,
      archivedAt: chat.archived_at,
      ...conversationOrigin(chat),
    }));
    return NextResponse.json({ chats });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
