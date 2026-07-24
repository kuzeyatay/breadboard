import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/ui-tars/service.ts";
import { uiTarsErrorResponse, readBody } from "@/lib/ui-tars/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string; runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId, runId } = await params;
    service.requireAgent(userId, agentId);
    const body = await readBody(request);
    await service.decide(userId, runId, String(body.actionId ?? ""), "reject");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}
