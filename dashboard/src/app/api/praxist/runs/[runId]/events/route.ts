import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { outerAgentEventsResponse } from "@/lib/runtime-v2/outer-agent-events-route.ts";
import { readOuterAgentRunView } from "@/lib/runtime-v2/outer-agent-run.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId } = await params;
    return await outerAgentEventsResponse({
      request,
      runId,
      readView: (since) => readOuterAgentRunView("praxist", userId, runId, since),
      pollMs: 600,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const status = error instanceof Error && error.message === "run_not_found" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: status === 404 ? "run_not_found" : "internal_error" },
      { status },
    );
  }
}
