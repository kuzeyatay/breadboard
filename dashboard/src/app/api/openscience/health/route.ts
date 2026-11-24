import { NextResponse } from "next/server";
import { SupervisorControlError } from "@/lib/supervisor-control.ts";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readOpenscienceRuntimeStatus } from "@/lib/openscience/runtime-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const { availability, setup, service } = await readOpenscienceRuntimeStatus({ userId });
    return NextResponse.json({
      ok: true,
      available: availability.available,
      reason: availability.reason ?? null,
      missing: availability.missing,
      setup,
      // The Runtime adapter may be awake for this check; this reports only the
      // research server it owns, never the adapter itself.
      service: service
        ? {
            running: true,
            workspacePath: service.workspacePath,
            startedAt: new Date(service.startedAt).toISOString(),
          }
        : { running: false },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    // A service that could not start says which one and why (no paths or secrets).
    if (error instanceof SupervisorControlError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
