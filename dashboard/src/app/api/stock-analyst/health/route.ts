import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { credentialStatus, VENDOR_CREDENTIALS } from "@/lib/stock-analyst/credentials.ts";
import { health } from "@/lib/stock-analyst/runtime.ts";
import { SETUP_ACTIONS } from "@/lib/stock-analyst/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUserId();
    // The probe really starts a Python interpreter, so the default read uses the
    // cached report; `?refresh=1` is the deliberate slow path taken after a
    // setup step.
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const snapshot = await health({ force: refresh });
    return NextResponse.json({
      ok: true,
      available: snapshot.available,
      cloned: snapshot.cloned,
      root: snapshot.root,
      environmentReady: snapshot.environmentReady,
      packageInstalled: snapshot.packageInstalled,
      systemPython: snapshot.systemPython,
      uvAvailable: snapshot.uvAvailable,
      version: snapshot.version,
      serviceRunning: snapshot.serviceRunning,
      reason: snapshot.reason,
      setupActions: SETUP_ACTIONS,
      credentials: VENDOR_CREDENTIALS.map((credential) => ({
        key: credential.key,
        label: credential.label,
        unlocks: credential.unlocks,
        link: credential.link,
        ...credentialStatus()[credential.key],
      })),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
