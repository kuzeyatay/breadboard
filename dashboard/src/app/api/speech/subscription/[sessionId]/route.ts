import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { requireVoiceOrigin, subscriptionBridge } from "@/lib/speech/subscription-server";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ sessionId: string }> };

async function forward(request: Request, context: Context) {
  try {
    const userId = await requireUserId();
    requireVoiceOrigin(request);
    const { sessionId } = await context.params;
    if (!/^[a-zA-Z0-9_-]{20,80}$/.test(sessionId)) throw new RouteError(400, "Invalid voice session.");
    const cursor = new URL(request.url).searchParams.get("cursor") || "0";
    if (!/^\d{1,6}$/.test(cursor)) throw new RouteError(400, "Invalid voice event cursor.");
    const body = request.method === "POST" ? await request.text() : undefined;
    if (body && body.length > 16000) throw new RouteError(413, "Speech text is too large.");
    return await subscriptionBridge(userId, `sessions/${sessionId}${request.method === "GET" ? `?cursor=${cursor}` : ""}`, {
      method: request.method, body, signal: request.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch (error) { return routeErrorResponse(error); }
}
export const GET = forward;
export const POST = forward;
export const DELETE = forward;
