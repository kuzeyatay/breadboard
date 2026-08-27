import { requireUserId } from "@/lib/server-auth";
import { outerAgentEventsResponse } from "@/lib/runtime-v2/outer-agent-events-route.ts";
import { readOuterAgentRunView } from "@/lib/runtime-v2/outer-agent-run.ts";
import { deepResearchErrorResponse } from "@/lib/deep-research/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { runId } = await params;
    return await outerAgentEventsResponse({
      request,
      runId,
      readView: (since) => readOuterAgentRunView("deep-research", userId, runId, since),
      pollMs: 1_000,
    });
  } catch (error) {
    return deepResearchErrorResponse(error);
  }
}
