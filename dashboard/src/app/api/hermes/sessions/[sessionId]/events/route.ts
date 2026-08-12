import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import { getConversationForUser } from "@/lib/conversations/store.ts";
import { resolveConversationRuntime } from "@/lib/hermes/session-service.ts";
import { buildSessionEventStream } from "@/lib/hermes/event-stream.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const conversation = getConversationForUser(sessionId, userId);
    const url = new URL(request.url);
    const surface = parseSurface(url.searchParams.get("surface"));
    const runtime = await resolveConversationRuntime({
      conversation,
      surface,
      activeGardenSlug: url.searchParams.get("gardenSlug"),
      activePageSlug: url.searchParams.get("pageSlug"),
    });
    return buildSessionEventStream(runtime, request.signal);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function parseSurface(value: string | null): HermesSurface {
  if (value && (HERMES_SURFACES as readonly string[]).includes(value)) {
    return value as HermesSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}
