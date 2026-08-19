// The canvas Run button. Returns the full run outcome — including the per-block
// trace — which the run drawer renders inline.

import { NextRequest, NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { runWorkflowById } from "@/lib/workflows/native-execution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { input?: unknown };
    const result = await runWorkflowById({
      workflowId: id,
      input: body.input,
      triggerKind: "manual",
      userId,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
