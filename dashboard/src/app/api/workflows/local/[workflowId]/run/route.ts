import { NextRequest, NextResponse } from "next/server";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import {
  ensureN8nSession,
  forwardN8nCookie,
  n8nJson,
} from "@/lib/workflows/n8n";
import { runLocalWorkflow } from "@/lib/workflows/execution";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  try {
    await requireUserId();
    const { workflowId } = await params;
    if (!/^[a-z0-9_-]{1,128}$/i.test(workflowId)) {
      throw new RouteError(400, "A valid automation is required.");
    }
    const body = await request.json().catch(() => ({})) as { input?: unknown };
    if (body.input !== undefined && typeof body.input !== "string") {
      throw new RouteError(400, "Automation input must be text.");
    }
    const session = await ensureN8nSession(request.cookies.get("n8n-auth")?.value);
    const workflow = await n8nJson(`/rest/workflows/${encodeURIComponent(workflowId)}`, {
      method: "GET",
      session,
    });
    const result = await runLocalWorkflow(workflow, body.input ?? "", session);
    const response = NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
    forwardN8nCookie(response, session);
    return response;
  } catch (error) {
    return routeErrorResponse(error);
  }
}
