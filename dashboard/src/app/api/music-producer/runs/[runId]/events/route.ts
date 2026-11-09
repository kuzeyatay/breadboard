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
    // Await the initial projection as well as admission so a transient Runtime
    // read failure cannot escape this route's structured error handling.
    return await outerAgentEventsResponse({ request, runId, readView: since => readRun(userId, runId, since), pollMs: 1000 });
  }
  catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return Response.json({ ok: false, error: "Music progress is temporarily unavailable. Please try again.", code: "RUNTIME_UNAVAILABLE" },
        { status: 503, headers: { "Retry-After": "1" } });
    }
    return musicRouteError(error);
  }
}
