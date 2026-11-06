import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { requireVoiceOrigin } from "@/lib/speech/subscription-server";
import { startWebLive } from "@/lib/speech/web-speech";

export const dynamic = "force-dynamic";

/** POST `{ context }`: start ChatGPT voice in the driven chatgpt.com page. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireVoiceOrigin(request);
    const raw = await request.text();
    if (raw.length > 300_000) throw new RouteError(413, "The conversation context is too large.");
    const body = JSON.parse(raw || "{}") as { context?: unknown };
    const context = typeof body.context === "string" ? body.context : "";
    return Response.json(await startWebLive(userId, context, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return routeErrorResponse(error); }
}
