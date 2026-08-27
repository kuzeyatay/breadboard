import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { SETUP_ACTIONS } from "@/lib/career-ops/setup.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { careerOpsHealthViaRuntime } from "@/lib/runtime-v2/career-ops-probe-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    // Keep the historical 30-second report cache; `?refresh=1` deliberately
    // submits a fresh disposable doctor worker unless a probe is already live.
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const snapshot = await careerOpsHealthViaRuntime({
      userId,
      force: refresh,
      signal: request.signal,
    });
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
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
