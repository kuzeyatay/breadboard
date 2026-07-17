import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { authorizeRuntimeSession } from "@/lib/openharness/session-service.ts";
import { buildSessionEventStream } from "@/lib/openharness/event-stream.ts";

export const dynamic = "force-dynamic";

function parseSessionId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "invalid_session_id", "Invalid session id.");
  }
  return id;
}

// GET (SSE): relay this session's normalized events to the client, streaming
// until the session goes idle/aborted/failed or the client disconnects, then
// persisting the finalized assistant turn exactly once. Shared streaming +
// persistence policy lives in buildSessionEventStream.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const session = authorizeRuntimeSession(userId, parseSessionId(sessionId));
    return buildSessionEventStream(session, request.signal);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
