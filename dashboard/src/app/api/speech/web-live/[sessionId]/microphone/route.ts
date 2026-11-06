import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { requireVoiceOrigin } from "@/lib/speech/subscription-server";
import { listenWebLive } from "@/lib/speech/web-speech";

export const dynamic = "force-dynamic";

/** POST { on }: voice mode's ring, muting or unmuting ChatGPT voice. */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const userId = await requireUserId();
    requireVoiceOrigin(request);
    const { sessionId } = await params;
    if (!/^[0-9a-f]{32}$/.test(sessionId)) throw new RouteError(400, "Invalid voice session.");
    const body = (await request.json().catch(() => null)) as { on?: unknown } | null;
    if (typeof body?.on !== "boolean") throw new RouteError(400, "Say whether the microphone is on.");
    return Response.json(await listenWebLive(userId, sessionId, body.on), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return routeErrorResponse(error); }
}
