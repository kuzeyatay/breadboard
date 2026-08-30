import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { toolchainStatus } from "@/lib/hyperframes/setup.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { runCodexProbeViaRuntime } from "@/lib/runtime-v2/codex-probe-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const codex = await runCodexProbeViaRuntime({ userId, signal: request.signal });
    const status = toolchainStatus({
      found: codex.available,
      version: codex.version ?? "",
    });
    return NextResponse.json({
      ok: true,
      available: status.ready,
      reason: status.reason || null,
      status,
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
