import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { runtimeAvailability } from "@/lib/openplanter/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const availability = runtimeAvailability();
    return NextResponse.json({
      ok: true,
      available: availability.available,
      installed: availability.installed,
      reason: availability.reason ?? null,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
