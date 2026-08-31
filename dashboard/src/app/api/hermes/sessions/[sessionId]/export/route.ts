import { requireUserId } from "@/lib/server-auth.ts";
import { getConversationForUser } from "@/lib/conversations/store.ts";
import { serializeConversationExport } from "@/lib/conversations/export.ts";
import { presentHermesSessionDetail } from "@/lib/hermes/session-presentation.ts";
import {
  ApiError,
  apiErrorResponse,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const requested = new URL(request.url).searchParams.get("format") ?? "json";
    if (requested !== "json" && requested !== "markdown") {
      throw new ApiError(
        400,
        "invalid_export_format",
        "Export format must be json or markdown.",
      );
    }
    const conversation = getConversationForUser(sessionId, userId);
    const serialized = serializeConversationExport(
      presentHermesSessionDetail(conversation),
      requested,
    );
    return new Response(serialized.body, {
      headers: {
        "content-type": serialized.contentType,
        "content-disposition": `attachment; filename="${serialized.filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
