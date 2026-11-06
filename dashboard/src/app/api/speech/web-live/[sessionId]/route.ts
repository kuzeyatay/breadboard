import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { requireVoiceOrigin } from "@/lib/speech/subscription-server";
import { pollWebLive, stopWebLive } from "@/lib/speech/web-speech";

export const dynamic = "force-dynamic";

function sessionId(value: string): string {
  if (!/^[0-9a-f]{32}$/.test(value)) throw new RouteError(400, "Invalid voice session.");
  return value;
}

/** GET: what was said since the last poll, and whether the voice is still on. */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const userId = await requireUserId();
    const id = sessionId((await params).sessionId);
    return Response.json(await pollWebLive(userId, id, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return routeErrorResponse(error); }
}

/** DELETE: hang up; answers with whatever was said since the last poll. */
export async function DELETE(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const userId = await requireUserId();
    requireVoiceOrigin(request);
    const id = sessionId((await params).sessionId);
    return Response.json(await stopWebLive(userId, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return routeErrorResponse(error); }
}
