import db from "@/lib/db.ts";
import { requireUserId } from "@/lib/server-auth";
import { requireSameOrigin } from "@/lib/request-origin";
import { ApiError, apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { listStarredMessages, setMessageStar } from "@/lib/starred-messages-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    return Response.json({ messages: listStarredMessages(db, await requireUserId()) }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    requireSameOrigin(request, "This origin cannot star messages.");
    const userId = await requireUserId();
    const body = await readJsonBody(request, 4096);
    if (typeof body.conversationId !== "string" || !body.conversationId || body.conversationId.length > 128 ||
        typeof body.messageId !== "string" || !body.messageId || body.messageId.length > 128 || typeof body.starred !== "boolean") {
      throw new ApiError(400, "invalid_message", "A chat, message and star state are required.");
    }
    setMessageStar(db, userId, { conversationId: body.conversationId, messageId: body.messageId, starred: body.starred });
    return Response.json({ messages: listStarredMessages(db, userId) }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}
