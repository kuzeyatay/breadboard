import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { getConversationForUser } from "@/lib/conversations/store.ts";
import { resolveConversationRuntime } from "@/lib/openharness/session-service.ts";
import { buildSessionEventStream } from "@/lib/openharness/event-stream.ts";
import { OPENHARNESS_SURFACES, type OpenHarnessSurface } from "@/lib/openharness/config.ts";

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

function parseSurface(value: string | null): OpenHarnessSurface {
  if (value && (OPENHARNESS_SURFACES as readonly string[]).includes(value)) {
    return value as OpenHarnessSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}
