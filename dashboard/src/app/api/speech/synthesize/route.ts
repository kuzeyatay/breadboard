import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { getSpeechSettings } from "@/lib/speech/settings";
import { voiceboxFetch, voiceboxJson, voiceboxResponseError } from "@/lib/speech/voicebox-client";

type VoiceProfile = {
  id: string;
  name: string;
  voice_type: "cloned" | "preset" | "designed";
  default_engine?: string | null;
  preset_engine?: string | null;
};

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const settings = getSpeechSettings(userId);
    if (!settings.enabled) throw new RouteError(409, "Speech is turned off in Intelligence → Settings → Speech.");
    if (!settings.profileId) throw new RouteError(409, "Choose a speech voice in Intelligence → Settings → Speech first.");
    const body = (await request.json()) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new RouteError(400, "There is no response text to speak.");
    if (text.length > 50_000) throw new RouteError(413, "Responses longer than 50,000 characters cannot be spoken at once.");

    const profile = await voiceboxJson<VoiceProfile>(
      `/profiles/${encodeURIComponent(settings.profileId)}`,
    );
    if (profile.voice_type === "cloned") {
      const samples = await voiceboxJson<unknown[]>(
        `/profiles/${encodeURIComponent(settings.profileId)}/samples`,
      );
      if (samples.length === 0) {
        throw new RouteError(
          409,
          `${profile.name} has no voice recording yet. Open Intelligence → Settings → Speech and finish cloning it first.`,
        );
      }
    }
    const engine =
      settings.engine === "auto"
        ? profile.default_engine || profile.preset_engine || "qwen"
        : settings.engine;
    const response = await voiceboxFetch(
      "/generate/stream",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          profile_id: settings.profileId,
          text,
          language: settings.language,
          engine,
          model_size: settings.modelSize,
        }),
      },
      10 * 60_000,
    );
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new RouteError(
        response.status,
        voiceboxResponseError(errorBody, "Voicebox could not synthesize this response."),
      );
    }
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
