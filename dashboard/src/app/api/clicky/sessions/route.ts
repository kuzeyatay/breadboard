import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { createConversation } from "@/lib/conversations/store.ts";

export async function POST() {
  try {
    const userId = await requireUserId();
    const conversation = createConversation({ userId, title: "New chat", originLabel: "Clicky" });
    return Response.json({ conversationId: conversation.public_id });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
