import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { authorizeQuartzRuntimeSession } from "@/lib/openharness/session-service.ts";
import { buildSessionEventStream } from "@/lib/openharness/event-stream.ts";
import { corsHeaders } from "@/lib/openharness/quartz-support.ts";

export const dynamic = "force-dynamic";

async function optionalUserId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const id = Number((session?.user as { id?: string } | undefined)?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

// GET (SSE): stream a Quartz page session's normalized events. Authorized by the
// same owner/client-token rule as the chat endpoint; the OpenHarness session id
// is derived server-side.
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    requireEnabled();
    const userId = await optionalUserId();
    const url = new URL(request.url);
    const sessionId = Number(url.searchParams.get("sessionId"));
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      throw new ApiError(400, "invalid_session_id", "A valid sessionId is required.");
    }
    const clientToken = url.searchParams.get("clientToken");
    const session = authorizeQuartzRuntimeSession(sessionId, { userId, clientToken });
    return buildSessionEventStream(session, request.signal, cors);
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
}
