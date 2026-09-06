import { requireUserId } from "@/lib/server-auth";
import { readRun } from "@/lib/music-producer/run-manager.ts";
import { outerAgentEventsResponse } from "@/lib/runtime-v2/outer-agent-events-route.ts";
import { musicRouteError } from "@/lib/music-producer/route-error.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: {
  params: Promise<{
    runId: string;
  }>;
}) {
  try {
    const userId = await requireUserId(), { runId } = await context.params;
    await readRun(userId, runId);
    return outerAgentEventsResponse({ request, runId, readView: since => readRun(userId, runId, since), pollMs: 1000 });
  }
  catch (error) {
    return musicRouteError(error);
  }
}
