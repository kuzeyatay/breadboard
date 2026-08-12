import { NextResponse } from "next/server";

import { recallErrorResponse } from "@/lib/recall/route-helpers.ts";
import { autoStartRecallCapture } from "@/lib/recall/service.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Breadboard just opened." Called once per app load by the browser, because
 * the session is the only thing that knows which user opened it — and capture
 * is that user's opt-in, not the machine's. Idempotent: reloading the page, or
 * having two windows open, never starts a second recorder.
 */
export async function POST() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ result: await autoStartRecallCapture(userId) });
  } catch (error) {
    return recallErrorResponse(error);
  }
}
