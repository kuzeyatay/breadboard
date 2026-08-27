import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { health } from "@/lib/deer-flow/runtime.ts";
import { SETUP_ACTIONS } from "@/lib/deer-flow/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUserId();
    // This is a filesystem + Runtime-ledger observation only. `?refresh=1`
    // invalidates its short cache after setup but never starts the Gateway.
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
