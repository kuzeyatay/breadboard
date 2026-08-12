import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { transcriptionAvailability } from "@/lib/meeting-notes/transcribe.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Meeting Notes has nothing of its own to install — the notes pass is ported
 * code running on ChatMock. What can be missing is a transcriber, so health is
 * a report on which of the two local engines this machine has, and what that
 * costs: no Scriberr means no speaker labels, and neither engine means only a
 * pasted transcript will work.
 *
 * That last case is still `available`. Refusing to select the agent because no
 * audio can be read would also block the transcript path, which needs nothing.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    const availability = await transcriptionAvailability(userId);
    return NextResponse.json({
      ok: true,
      available: true,
      engine: availability.engine,
      scriberr: availability.scriberr,
      voicebox: availability.voicebox,
      speakerLabels: availability.speakerLabels,
      detail: availability.detail,
      reason: null,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
