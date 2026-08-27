import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { outerAgentEventsResponse } from "@/lib/runtime-v2/outer-agent-events-route.ts";
import { readOuterAgentRunView } from "@/lib/runtime-v2/outer-agent-run.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId } = await params;
    const url = new URL(request.url);
    const since =
      Number(request.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0) || 0;
    const readView = (cursor: number) =>
      readOuterAgentRunView("vibe-trading", userId, runId, cursor);
    // Preserve the old synchronous 404 for an unknown SSE run. The shared
    // stream helper otherwise discovers it after the response is committed.
    if ((request.headers.get("accept") ?? "").includes("text/event-stream")) {
      await readView(since);
    }
    return outerAgentEventsResponse({
      request,
      runId,
      readView,
      // Preserve the card's existing half-second replay cadence.
      pollMs: 500,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const status = error instanceof Error && error.message === "run_not_found" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: status === 404 ? "run_not_found" : "internal_error" },
      { status },
    );
  }
}
