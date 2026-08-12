import { NextResponse } from "next/server";

import { readRecallBody, recallErrorResponse } from "@/lib/recall/route-helpers.ts";
import { searchRecall } from "@/lib/recall/service.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The tab's own search: it shows the owner exactly what a `recall_search` call
 * would return, so "what can the agent see about me?" is answerable by looking
 * rather than by trusting the description.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readRecallBody(request);
    const result = await searchRecall(userId, {
      query: typeof body.query === "string" ? body.query : undefined,
      contentType:
        body.contentType === "screen" || body.contentType === "audio"
          ? body.contentType
          : "all",
      limit: typeof body.limit === "number" ? body.limit : undefined,
      startTime: typeof body.startTime === "string" ? body.startTime : undefined,
      endTime: typeof body.endTime === "string" ? body.endTime : undefined,
      appName: typeof body.appName === "string" ? body.appName : undefined,
    });
    return NextResponse.json({ result });
  } catch (error) {
    return recallErrorResponse(error);
  }
}
