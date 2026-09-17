import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { requireVoiceOrigin } from "@/lib/speech/subscription-server";
import { elevenLabsCredentialStatus, forgetElevenLabsApiKey, storeElevenLabsApiKey } from "@/lib/speech/elevenlabs-credentials";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    requireVoiceOrigin(request);
    const body = await request.json();
    storeElevenLabsApiKey(userId, body?.apiKey);
    return Response.json(elevenLabsCredentialStatus(userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return routeErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    requireVoiceOrigin(request);
    forgetElevenLabsApiKey(userId);
    return Response.json(elevenLabsCredentialStatus(userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return routeErrorResponse(error); }
}
