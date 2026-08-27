import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/agent-browser/service.ts";
import { agentBrowserErrorResponse, readBody } from "@/lib/agent-browser/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId } = await params;
    const body = await readBody(request);
    const task = typeof body.task === "string" ? body.task : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : undefined;
    const result = await service.startRun(userId, agentId, task, requestId);
    return NextResponse.json({ ok: true, run: result }, { status: 201 });
  } catch (error) {
    return agentBrowserErrorResponse(error);
  }
}
