// The microphone recording for one demonstration.
//
// The browser records the narration (which is also what makes the consent
// explicit and the level meter possible) and uploads it here when the session
// finishes. The body is the raw audio streamed to disk rather than a parsed
// form, so a long demonstration costs a buffer at a time instead of a heap.
//
// The offset header is how the two clocks are joined: it says where the
// microphone started relative to the recording epoch the start call returned.

import { NextRequest, NextResponse } from "next/server";

import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { storeNarration } from "@/lib/teach/session-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const AUDIO_OFFSET_HEADER = "x-narration-offset-ms";

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const userId = await requireUserId();
    const { sessionId } = await context.params;

    const rawOffset = Number(request.headers.get(AUDIO_OFFSET_HEADER) ?? "0");
    if (!Number.isFinite(rawOffset)) {
      throw new RouteError(400, "The narration's start offset was not a number.");
    }

    const result = await storeNarration({
      userId,
      sessionId,
      body: request.body,
      audioStartOffsetMs: rawOffset,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
