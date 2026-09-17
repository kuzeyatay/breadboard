import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { listElevenLabsVoices } from "@/lib/speech/elevenlabs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const cursor = new URL(request.url).searchParams.get("cursor");
    return Response.json(await listElevenLabsVoices(userId, cursor, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return routeErrorResponse(error); }
}
