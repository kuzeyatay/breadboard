import { NextResponse } from "next/server";
import { SupervisorControlError } from "@/lib/supervisor-control.ts";
import { openExecutiveHealth } from "@/lib/openexecutive/runtime.ts";
import { OPENEXECUTIVE_SETUP_ACTIONS } from "@/lib/openexecutive/setup.ts";
import { requireUserId, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const health = openExecutiveHealth();
    return NextResponse.json({ ok: true, ...health, setupActions: OPENEXECUTIVE_SETUP_ACTIONS });
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
