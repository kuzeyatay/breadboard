import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import {
  MatraixProbeError,
  runMatraixProbeViaRuntime,
} from "@/lib/runtime-v2/matraix-probe-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const status = await runMatraixProbeViaRuntime({ userId, signal: request.signal });
    return NextResponse.json({
      ok: true,
      available: status.ready,
      reason: status.reason || null,
      status,
    });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof MatraixProbeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
