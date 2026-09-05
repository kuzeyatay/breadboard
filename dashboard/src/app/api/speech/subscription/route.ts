import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { getSpeechSettings } from "@/lib/speech/settings";
import { requireVoiceOrigin, subscriptionBridge } from "@/lib/speech/subscription-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireVoiceOrigin(request);
    const settings = getSpeechSettings(userId);
    if (!settings.enabled || settings.speechProvider !== "chatgpt") throw new RouteError(409, "Choose ChatGPT subscription and enable speech in Voice settings first.");
    const raw = await request.text();
    if (raw.length > 80_000) throw new RouteError(413, "Voice connection request is too large.");
    const body = JSON.parse(raw);
    if (typeof body.sdp !== "string" || !body.sdp.startsWith("v=0") || !["speak", "transcribe", "conversation"].includes(body.mode)) throw new RouteError(400, "Invalid voice connection request.");
    return await subscriptionBridge(userId, "sessions", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
      body: JSON.stringify({ sdp: body.sdp, mode: body.mode, voice: settings.openaiVoice, language: settings.transcriptionLanguage }),
    });
  } catch (error) { return routeErrorResponse(error); }
}
