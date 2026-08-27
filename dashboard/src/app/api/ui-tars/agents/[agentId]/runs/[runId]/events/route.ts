import { requireUserId } from "@/lib/server-auth";
import { outerAgentEventsResponse } from "@/lib/runtime-v2/outer-agent-events-route.ts";
import { readEventsView } from "@/lib/ui-tars/runtime-run-manager.ts";
import { uiTarsErrorResponse } from "@/lib/ui-tars/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Durable normalized projection. Runtime owns replay and liveness; the
// dashboard only authorizes this agent/run pair and consumes its sealed view.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { agentId, runId } = await params;
    return await outerAgentEventsResponse({
      request,
      runId,
      readView: (since) => readEventsView(userId, agentId, runId, since),
      pollMs: 500,
    });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}
