import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/agent-browser/service.ts";
import { decideApproval } from "@/lib/agent-browser/run-manager.ts";
import { agentBrowserErrorResponse, readBody } from "@/lib/agent-browser/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string; runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId, runId } = await params;
    service.requireAgent(userId, agentId);
    const body = await readBody(request);
    const actionId = typeof body.actionId === "string" ? body.actionId : "";
    const ok = decideApproval(userId, runId, actionId, "approve");
    return NextResponse.json({ ok });
  } catch (error) {
    return agentBrowserErrorResponse(error);
  }
}
