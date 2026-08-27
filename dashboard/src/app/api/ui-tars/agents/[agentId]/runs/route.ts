import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as store from "@/lib/ui-tars/store.ts";
import { UITarsServiceError } from "@/lib/ui-tars/errors.ts";
import { refreshAgentRuns, startRun } from "@/lib/ui-tars/runtime-run-manager.ts";
import { uiTarsErrorResponse, readBody } from "@/lib/ui-tars/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/ui-tars/agents/:agentId/runs
export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId } = await params;
    if (!store.getAgent(userId, agentId)) throw new UITarsServiceError(404, "agent_not_found");
    await refreshAgentRuns(userId, agentId);
    const runs = store.listRuns(userId, agentId).map((r) => ({
      id: r.id,
      status: r.status,
      task: r.task,
      createdAt: r.created_at,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      failureCode: r.failure_code,
    }));
    return NextResponse.json({ ok: true, runs });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}

// POST /api/ui-tars/agents/:agentId/runs — launch an isolated browser task.
export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId } = await params;
    const body = await readBody(request);
    const summary = await startRun(userId, agentId, String(body.task ?? ""), {
      requestId: typeof body.requestId === "string" ? body.requestId : undefined,
    });
    return NextResponse.json({ ok: true, run: { id: summary.runId, status: summary.status } }, { status: 201 });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}
