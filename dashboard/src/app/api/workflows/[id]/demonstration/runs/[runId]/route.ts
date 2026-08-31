// One run of a learned workflow: what it has done so far, and the three things
// a person can say about it while it is happening -- approve, reject, stop.
//
// Stop is not advisory. It aborts the loop and kills the process that can move
// the pointer, and only reports the run stopped once that has happened.

import { NextRequest, NextResponse } from "next/server";

import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { decideApproval, isRunActive, stopDemonstrationRun } from "@/lib/teach/replay";
import * as store from "@/lib/teach/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; runId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { id, runId } = await context.params;
    const row = store.getRun(userId, runId);
    if (!row || row.workflow_id !== id) throw new RouteError(404, "That run does not exist.");

    const view = store.runView(row);
    const since = Number(request.nextUrl.searchParams.get("since") ?? "0");
    const events = Number.isFinite(since) && since > 0
      ? view.events.filter((event) => event.sequence > since)
      : view.events;

    return NextResponse.json(
      {
        ...view,
        events,
        // Whether a process is actually driving right now, which is not the same
        // as what the stored state says after a restart.
        live: isRunActive(runId),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; runId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { id, runId } = await context.params;
    const row = store.getRun(userId, runId);
    if (!row || row.workflow_id !== id) throw new RouteError(404, "That run does not exist.");

    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    switch (body.action) {
      case "approve":
      case "reject": {
        const decided = decideApproval(userId, runId, body.action === "approve");
        if (!decided) throw new RouteError(409, "That run is not waiting for an answer.");
        return NextResponse.json({ ok: true });
      }
      case "stop": {
        const stopped = await stopDemonstrationRun(userId, runId);
        if (!stopped) throw new RouteError(409, "That run has already finished.");
        return NextResponse.json({ ok: true });
      }
      default:
        throw new RouteError(400, "Unknown action.");
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
