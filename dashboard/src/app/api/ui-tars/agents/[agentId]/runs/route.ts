import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/ui-tars/service.ts";
import * as store from "@/lib/ui-tars/store.ts";
import { uiTarsErrorResponse, readBody } from "@/lib/ui-tars/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/ui-tars/agents/:agentId/runs
export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId } = await params;
    service.requireAgent(userId, agentId);
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
    const summary = await service.startRun(userId, agentId, String(body.task ?? ""));
    return NextResponse.json({ ok: true, run: { id: summary.runId, status: summary.status } }, { status: 201 });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}
