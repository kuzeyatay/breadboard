import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { spotifyPlaybackEventStream } from "@/lib/spotify/playback-events.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    requireEnabled();
    const userId = await requireUserId();
    return new Response(spotifyPlaybackEventStream(userId, request.signal), { headers: {
      "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    } });
  } catch (error) { return apiErrorResponse(error); }
}
