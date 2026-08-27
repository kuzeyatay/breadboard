import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { SETUP_ACTIONS } from "@/lib/shorts/setup.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import {
  PythonAgentProbeError,
  shortsHealthViaRuntime,
} from "@/lib/runtime-v2/python-agent-probe-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    // The probe really starts a Python interpreter, so the default read uses
    // the cached report; `?refresh=1` is the deliberate slow path taken after a
    // setup step.
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const snapshot = await shortsHealthViaRuntime({
      userId,
      force: refresh,
      signal: request.signal,
    });
    return NextResponse.json({
      ok: true,
      available: snapshot.available,
      cloned: snapshot.cloned,
      root: snapshot.root,
      environmentReady: snapshot.environmentReady,
      dependenciesInstalled: snapshot.dependenciesInstalled,
      missing: snapshot.missing,
      systemPython: snapshot.systemPython,
      uvAvailable: snapshot.uvAvailable,
      ffmpeg: snapshot.ffmpeg,
      bridgeFound: snapshot.bridgeFound,
      reason: snapshot.reason,
      setupActions: SETUP_ACTIONS,
    });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof PythonAgentProbeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
