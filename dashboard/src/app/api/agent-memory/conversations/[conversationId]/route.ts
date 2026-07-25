import { NextResponse } from "next/server";
import { clearConversationMemoryState } from "@/lib/conversations/memory-inspection";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * Clear one chat's rolling summary and working state. The exact transcript is
 * untouched — only the compacted memory derived from it is reset.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const userId = await requireUserId();
    const conversationId = Number((await params).conversationId);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new RouteError(400, "A valid conversation id is required.");
    }
    if (!clearConversationMemoryState(userId, conversationId)) {
      throw new RouteError(404, "That chat's memory could not be found.");
    }
    return NextResponse.json({ ok: true, conversationId });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
