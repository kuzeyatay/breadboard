import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { runAgentReachDoctorJob } from "@/lib/runtime-v2/agent-reach-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const health = await runAgentReachDoctorJob({
      userId,
      force: refresh,
      signal: request.signal,
    });
    return NextResponse.json({
      ok: true,
      available: health.available,
      cloned: health.cloned,
      reason: health.reason,
      channels: health.channels.map((channel) => ({
        channel: channel.channel,
        status: channel.status,
        tier: channel.tier,
        activeBackend: channel.activeBackend,
        backends: channel.backends,
        message: channel.message,
      })),
    });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
