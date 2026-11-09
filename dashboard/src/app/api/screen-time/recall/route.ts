import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { searchRecall } from "@/lib/recall/service";
import { readRecallBody, recallErrorResponse } from "@/lib/recall/route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const userId = await requireUserId(), body = await readRecallBody(request);
    const start = typeof body.start === "number" ? body.start : NaN;
    const end = typeof body.end === "number" ? body.end : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= start || end - start > 32 * 86400000)
      throw new RouteError(400, "Choose an activity to revisit.");
    const result = await searchRecall(userId, { contentType: "screen", limit: 10,
      startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(),
      appName: typeof body.app === "string" ? body.app.slice(0, 300) : undefined,
      windowName: typeof body.title === "string" ? body.title.slice(0, 300) : undefined });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return recallErrorResponse(error); }
}
