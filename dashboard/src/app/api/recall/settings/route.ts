import { NextResponse } from "next/server";

import { readRecallBody, recallErrorResponse } from "@/lib/recall/route-helpers.ts";
import { getRecallSettings, updateRecallSettings } from "@/lib/recall/settings.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ settings: getRecallSettings(userId) });
  } catch (error) {
    return recallErrorResponse(error);
  }
}

/**
 * Partial update. Every field is clamped server-side, so a value the UI does
 * not offer cannot widen what is captured or what the agent may read.
 */
export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readRecallBody(request);
    return NextResponse.json({ settings: updateRecallSettings(userId, body) });
  } catch (error) {
    return recallErrorResponse(error);
  }
}
