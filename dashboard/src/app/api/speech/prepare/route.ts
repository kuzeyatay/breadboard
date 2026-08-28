import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { voiceboxJson } from "@/lib/speech/voicebox-client";

export const dynamic = "force-dynamic";

/**
 * Starts the on-demand local speech service and waits for its health contract
 * before the voice screen opens the microphone. This keeps a cold start from
 * consuming the user's first spoken turn.
 */
export async function POST() {
  try {
    await requireUserId();
    await voiceboxJson<{ models: unknown[] }>("/models/status", {}, 10 * 60_000);
    return NextResponse.json({ ready: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
