import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getEventsSince, getRun } from "@/lib/max-research/runtime-run-manager.ts";
import { outerAgentEventsResponse } from "@/lib/runtime-v2/outer-agent-events-route.ts";
import { readOuterAgentRunView } from "@/lib/runtime-v2/outer-agent-run.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A Max Research run is measured in tens of minutes, so a client that reloads
// mid-run has to rejoin rather than start over: `since` and `Last-Event-ID`
// both resume from a sequence number. Runtime's durable checkpoint survives a
// dashboard reload/restart; this route owns no timer or execution state.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const userId = await requireUserId();
  const { runId } = await params;
  const url = new URL(request.url);
  const since =
    Number(
      request.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0,
    ) || 0;

  if (!(request.headers.get("accept") ?? "").includes("text/event-stream")) {
    return NextResponse.json({
      ok: true,
      events: await getEventsSince(userId, runId, since),
    });
  }

  if (!(await getRun(userId, runId))) {
    return NextResponse.json({ ok: false, error: "run_not_found" }, { status: 404 });
  }
  return outerAgentEventsResponse({
    request,
    runId,
    readView: (cursor) =>
      readOuterAgentRunView("max-research", userId, runId, cursor),
    // Preserve Max Research's intentionally quiet three-second polling cadence.
    pollMs: 3_000,
  });
}
