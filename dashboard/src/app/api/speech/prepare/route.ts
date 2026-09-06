import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { voiceboxJson } from "@/lib/speech/voicebox-client";
import { getSpeechSettings } from "@/lib/speech/settings";
import { subscriptionStatus } from "@/lib/speech/subscription-server";

export const dynamic = "force-dynamic";

/**
 * Prepares the selected speech provider before opening the microphone. Cloud
 * checks credentials only; Local waits for the on-demand Voicebox service.
 */
export async function POST() {
  try {
    const userId = await requireUserId();
    if (getSpeechSettings(userId).speechProvider === "chatgpt") {
      const status = await subscriptionStatus(userId);
      if (!status.configured) throw new RouteError(503, status.error || "The subscription voice connection is unavailable. Re-check it in Voice settings.");
      return NextResponse.json({ ready: true, provider: "chatgpt" });
    }
    await voiceboxJson<{ models: unknown[] }>("/models/status", {}, 10 * 60_000);
    return NextResponse.json({ ready: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
