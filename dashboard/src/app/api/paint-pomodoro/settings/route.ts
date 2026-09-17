import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { readJsonBody, ApiError } from "@/lib/hermes/route-core.ts";
import { requireSameOrigin } from "@/lib/request-origin";
import { parsePaintPomodoroDurations } from "@/lib/paint-pomodoro-settings";
import { readPaintPomodoroDurations, writePaintPomodoroDurations } from "@/lib/paint-pomodoro-settings-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      { durations: readPaintPomodoroDurations(db, await requireUserId()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    requireSameOrigin(request, "Save timer settings from Breadboard.");
    const durations = parsePaintPomodoroDurations(await readJsonBody(request, 1_024));
    if (!durations) throw new ApiError(400, "invalid_durations", "Timer durations must be between 1 and 180 minutes.");
    return NextResponse.json({ durations: writePaintPomodoroDurations(db, userId, durations) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
