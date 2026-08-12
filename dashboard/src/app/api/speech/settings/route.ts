import { NextResponse } from "next/server";
import { getSpeechSettings, updateSpeechSettings } from "@/lib/speech/settings";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ settings: getSpeechSettings(userId) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json({ settings: updateSpeechSettings(userId, body) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

