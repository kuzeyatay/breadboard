import db from "@/lib/db.ts";
import { requireReadableCluster, requireUserId } from "@/lib/server-auth";
import { requireSameOrigin } from "@/lib/request-origin";
import { ApiError, apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getStarredMessageContent, listStarredMessages, setMessageStar } from "@/lib/starred-messages-store.ts";
import { starredPdfGardenId } from "@/lib/starred-pdf-garden.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const messageId = new URL(request.url).searchParams.get("message");
    if (messageId !== null) {
      if (messageId.length > 128 || !/^msg_[1-9]\d*$/.test(messageId)) {
        throw new ApiError(400, "invalid_message", "A saved message is required.");
      }
      return Response.json({ message: getStarredMessageContent(db, userId, messageId) }, { headers });
    }
    return Response.json({ messages: listStarredMessages(db, userId) }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    requireSameOrigin(request, "This origin cannot star messages.");
    const userId = await requireUserId();
    const body = await readJsonBody(request, 4096);
    if (typeof body.conversationId !== "string" || !body.conversationId || body.conversationId.length > 128 ||
        typeof body.messageId !== "string" || !body.messageId || body.messageId.length > 128 || typeof body.starred !== "boolean" ||
        (body.sourceUrl !== undefined && (typeof body.sourceUrl !== "string" || body.sourceUrl.length > 2048))) {
      throw new ApiError(400, "invalid_message", "A chat, message and star state are required.");
    }
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : undefined;
    setMessageStar(db, userId, {
      conversationId: body.conversationId, messageId: body.messageId, starred: body.starred,
      pdfGardenId: sourceUrl ? () => starredPdfGardenId(db, userId, request, sourceUrl,
        slug => requireReadableCluster(userId, slug).id) : undefined,
    });
    return Response.json({ messages: listStarredMessages(db, userId) }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}
