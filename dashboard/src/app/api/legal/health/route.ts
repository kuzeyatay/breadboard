import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { health } from "@/lib/legal/runtime.ts";
import { SETUP_ACTIONS } from "@/lib/legal/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUserId();
    // The probe really starts a Python interpreter, so the default read uses
    // the cached report; `?refresh=1` is the deliberate slow path taken after a
    // setup step.
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const snapshot = await health({ force: refresh });
    return NextResponse.json({
      ok: true,
      available: snapshot.available,
      cloned: snapshot.cloned,
      root: snapshot.root,
      environmentReady: snapshot.environmentReady,
      harnessImportable: snapshot.harnessImportable,
      // Neither stops a run, and both change what it can do — a card that says
      // "no pandoc" explains an oddly-read Word file before anyone files a bug.
      pandocAvailable: snapshot.pandocAvailable,
      shellAvailable: snapshot.shellAvailable,
      systemPython: snapshot.systemPython,
      uvAvailable: snapshot.uvAvailable,
      bridgeFound: snapshot.bridgeFound,
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
