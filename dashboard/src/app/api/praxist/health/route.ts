import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { configuredMaxResearchTaskPath, runtimeReadiness } from "@/lib/praxist/runtime.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const readiness = runtimeReadiness();
    return NextResponse.json({
      ok: true,
      available: readiness.available,
      cloned: readiness.cloned,
      agreementAccepted: readiness.agreementAccepted,
      codexInstalled: readiness.codexInstalled,
      maxResearchTaskConfigured: Boolean(configuredMaxResearchTaskPath()),
      reason: readiness.reason ?? null,
      setupCommand: readiness.setupCommand,
      root: readiness.runtime?.root ?? null,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
