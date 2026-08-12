import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { health } from "@/lib/career-ops/runtime.ts";
import { SETUP_ACTIONS } from "@/lib/career-ops/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUserId();
    // The probe spawns the clone's own doctor, so the default response uses the
    // cached report; `?refresh=1` is the deliberate slow path.
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const snapshot = await health({ force: refresh });
    return NextResponse.json({
      ok: true,
      available: snapshot.available,
      cloned: snapshot.cloned,
      root: snapshot.root,
      dependenciesInstalled: snapshot.dependenciesInstalled,
      browsersInstalled: snapshot.browsersInstalled,
      onboardingNeeded: snapshot.onboarding?.onboardingNeeded ?? null,
      missing: snapshot.onboarding?.missing ?? [],
      warnings: snapshot.onboarding?.warnings ?? [],
      modeCount: snapshot.modeCount,
      trackedApplications: snapshot.trackedApplications,
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
