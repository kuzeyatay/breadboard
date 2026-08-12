import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { health } from "@/lib/deer-flow/runtime.ts";
import { SETUP_ACTIONS } from "@/lib/deer-flow/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUserId();
    // The probe really starts a Python interpreter and imports the Gateway, so
    // the default read uses the cached report; `?refresh=1` is the deliberate
    // slow path taken after a setup step.
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const snapshot = await health({ force: refresh });
    return NextResponse.json({
      ok: true,
      available: snapshot.available,
      cloned: snapshot.cloned,
      root: snapshot.root,
      environmentReady: snapshot.environmentReady,
      packageInstalled: snapshot.packageInstalled,
      uvAvailable: snapshot.uvAvailable,
      version: snapshot.version,
      serviceRunning: snapshot.serviceRunning,
      reason: snapshot.reason,
      setupActions: SETUP_ACTIONS,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
