import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { getSpeechSettings } from "@/lib/speech/settings";
import { voiceboxFetch, voiceboxResponseError } from "@/lib/speech/voicebox-client";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const settings = getSpeechSettings(userId);
    if (!settings.enabled) throw new RouteError(409, "Speech is turned off in Intelligence → Settings → Speech.");
    const incoming = await request.formData();
    const file = incoming.get("file");
    if (!(file instanceof File) || file.size === 0) throw new RouteError(400, "No microphone recording was received.");
    if (file.size > MAX_AUDIO_BYTES) throw new RouteError(413, "Dictation recordings may be at most 25 MB.");

    if (settings.speechProvider === "chatgpt") {
      throw new RouteError(409, "Subscription dictation requires the browser audio connection. Reload Breadboard and try again.");
    }

    const outgoing = new FormData();
    outgoing.set("file", file, file.name || "dictation.webm");
    outgoing.set("model", settings.transcriptionModel);
    if (settings.transcriptionLanguage) outgoing.set("language", settings.transcriptionLanguage);
    const response = await voiceboxFetch(
      "/transcribe",
      { method: "POST", body: outgoing, signal: request.signal },
      10 * 60_000,
    );
    const body = await response.json().catch(() => null);
    // A model download is accepted work, but it is not a transcription yet.
    // Preserve Voicebox's 202 so the composer can wait and retry the same WAV.
    if (response.status === 202) {
      return NextResponse.json(
        {
          error: voiceboxResponseError(body, "Voicebox is preparing the local transcription model."),
          downloading: true,
        },
        { status: 202 },
      );
    }
    if (!response.ok) {
      const message = voiceboxResponseError(body, "Voicebox could not transcribe this recording.");
      return NextResponse.json(
        { error: message },
        { status: response.status },
      );
    }
    return NextResponse.json(body);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
