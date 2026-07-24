import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/ui-tars/service.ts";
import { uiTarsErrorResponse } from "@/lib/ui-tars/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET a run + its full persisted timeline (refresh recovery reads from here).
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string; runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId, runId } = await params;
    service.requireAgent(userId, agentId);
    const since = Number(new URL(request.url).searchParams.get("since") ?? 0) || 0;
    const view = await service.runView(userId, runId, since);
    return NextResponse.json({
      ok: true,
      run: {
        id: view.run.id,
        agentId: view.run.agent_id,
        status: view.run.status,
        task: view.run.task,
        createdAt: view.run.created_at,
        startedAt: view.run.started_at,
        completedAt: view.run.completed_at,
        abortedAt: view.run.aborted_at,
        failureCode: view.run.failure_code,
        failureMessage: view.run.failure_message,
      },
      events: view.events,
      pendingApproval: view.live?.pendingApproval ?? null,
    });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}
