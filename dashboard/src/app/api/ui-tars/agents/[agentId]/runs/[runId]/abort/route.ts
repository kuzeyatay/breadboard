import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/ui-tars/service.ts";
import { uiTarsErrorResponse } from "@/lib/ui-tars/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ agentId: string; runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId, runId } = await params;
    service.requireAgent(userId, agentId);
    await service.abort(userId, runId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}
