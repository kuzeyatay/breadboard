import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { forgetSpeechApiKey } from "@/lib/speech/credentials";

export const dynamic = "force-dynamic";

export async function PUT() {
  try {
    await requireUserId();
    throw new RouteError(410, "API-key speech has been removed. Use ChatGPT subscription in Voice settings.");
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const userId = await requireUserId();
    forgetSpeechApiKey(userId);
    return NextResponse.json({ removed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
