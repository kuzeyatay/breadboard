// User-driven run of a saved workflow, invoked from the chat palette and the
// garden workspace. The response is the shared WorkflowRunResponse so the chat
// surfaces can post `assistantContent` straight into the transcript.

import { NextRequest, NextResponse } from "next/server";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { runWorkflowById } from "@/lib/workflows/native-execution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { workflowId } = await params;
    if (!/^[a-z0-9-]{1,128}$/i.test(workflowId)) {
      throw new RouteError(400, "A valid automation is required.");
    }
    const body = (await request.json().catch(() => ({}))) as { input?: unknown };
    if (body.input !== undefined && typeof body.input !== "string") {
      throw new RouteError(400, "Automation input must be text.");
    }
    const result = await runWorkflowById({
      workflowId,
      input: body.input ?? "",
      triggerKind: "chat",
      userId,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
