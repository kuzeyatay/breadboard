import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { voiceboxJson } from "@/lib/speech/voicebox-client";
import { getSpeechSettings } from "@/lib/speech/settings";
import { subscriptionStatus } from "@/lib/speech/subscription-server";
import { elevenLabsCredentialStatus } from "@/lib/speech/elevenlabs-credentials";
import { webSpeechStatus } from "@/lib/speech/web-speech";

export const dynamic = "force-dynamic";

/**
 * Prepares the selected speech provider before opening the microphone. Cloud
 * checks credentials only; Local waits for the on-demand Voicebox service.
 */
export async function POST() {
  try {
    const userId = await requireUserId();
    if (getSpeechSettings(userId).speechProvider === "elevenlabs") {
      const status = elevenLabsCredentialStatus(userId);
      if (!status.configured) throw new RouteError(409, status.error || "Add your ElevenLabs API key in Voice settings first.");
      return NextResponse.json({ ready: true, provider: "elevenlabs" });
    }
    if (getSpeechSettings(userId).speechProvider === "chatgpt") {
      const status = await subscriptionStatus(userId);
      if (!status.configured) throw new RouteError(503, status.error || "The subscription voice connection is unavailable. Re-check it in Voice settings.");
      return NextResponse.json({ ready: true, provider: "chatgpt" });
    }
    if (getSpeechSettings(userId).speechProvider === "openaiweb") {
      const status = await webSpeechStatus(userId);
      if (!status.configured) throw new RouteError(503, status.error || "OpenAI (web) speech is unavailable. Re-check it in Voice settings.");
      return NextResponse.json({ ready: true, provider: "openaiweb" });
    }
    await voiceboxJson<{ models: unknown[] }>("/models/status", {}, 10 * 60_000);
    return NextResponse.json({ ready: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
