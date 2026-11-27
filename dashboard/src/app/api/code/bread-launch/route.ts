import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { requireSameOrigin } from "@/lib/request-origin";
import { ApiError, apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getConversationForUser } from "@/lib/conversations/store.ts";
import { setPendingBreadChat, takePendingBreadChat } from "@/lib/code-bread-launch.ts";

export const dynamic = "force-dynamic";

/** Launch a Code chat: Bread in VS Code opens it the next time it asks. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request, "This origin cannot open chats in Code.");
    const userId = await requireUserId();
    const body = await readJsonBody(request);
    const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
    if (!/^conv_[\w-]+$/.test(chatId)) {
      throw new ApiError(400, "invalid_chat", "A chat is required.");
    }
    // Only the reader's own chat can be handed to their Bread.
    getConversationForUser(chatId, userId);
    setPendingBreadChat(userId, chatId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Bread's half: the chat waiting for it, taken once. */
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request, "This origin cannot read Code launches.");
    const userId = await requireUserId();
    return NextResponse.json({ chatId: takePendingBreadChat(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
