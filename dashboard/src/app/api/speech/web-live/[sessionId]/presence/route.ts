import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { presenceWebLive } from "@/lib/speech/web-speech";

export const dynamic = "force-dynamic";

/** GET: held open by the voice screen; the tab closing closes it, and the
 * dropped connection carries through to ChatMock, which hangs up. */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const userId = await requireUserId();
    const { sessionId } = await params;
    if (!/^[0-9a-f]{32}$/.test(sessionId)) throw new RouteError(400, "Invalid voice session.");
    const upstream = await presenceWebLive(userId, sessionId, request.signal);
    return new Response(upstream.body, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } catch (error) { return routeErrorResponse(error); }
}
