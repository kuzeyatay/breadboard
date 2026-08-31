// Running a learned workflow, with new inputs.
//
// The run drives the desktop, so it starts in the background and reports through
// its own record: the caller gets a run id immediately and follows it, which is
// what lets the Stop button exist while the run is still going.

import { NextRequest, NextResponse } from "next/server";

import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { ensureTeachRecovery } from "@/lib/teach/recovery";
import { startDemonstrationRun } from "@/lib/teach/replay";
import * as store from "@/lib/teach/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_INPUT_LENGTH = 2_000;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    // Settle anything a previous process left claiming to be live.
    ensureTeachRecovery();
    const userId = await requireUserId();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { inputs?: unknown };

    const inputs: Record<string, string> = {};
    if (body.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)) {
      for (const [key, value] of Object.entries(body.inputs as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        if (!/^[a-zA-Z0-9_]{1,64}$/u.test(key)) continue;
        inputs[key] = value.slice(0, MAX_INPUT_LENGTH);
      }
    }

    if (!store.isDemonstratedWorkflow(userId, id)) {
      throw new RouteError(404, "That workflow was not learned from a demonstration.");
    }

    const { runId } = startDemonstrationRun({ userId, workflowId: id, inputs });
    return NextResponse.json({ runId }, { status: 202 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    // Settle anything a previous process left claiming to be live.
    ensureTeachRecovery();
    const userId = await requireUserId();
    const { id } = await context.params;
    const runs = store.listRuns(userId, id, 20).map((row) => store.runView(row));
    return NextResponse.json({ runs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
