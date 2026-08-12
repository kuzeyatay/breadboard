import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/agent-browser/service.ts";
import { abortRun } from "@/lib/agent-browser/run-manager.ts";
import { agentBrowserErrorResponse } from "@/lib/agent-browser/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ agentId: string; runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId, runId } = await params;
    service.requireAgent(userId, agentId);
    const ok = abortRun(userId, runId);
    return NextResponse.json({ ok });
  } catch (error) {
    return agentBrowserErrorResponse(error);
  }
}
