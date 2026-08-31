import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { godsEyeAvailability } from "@/lib/gods-eye/runtime.ts";
import { currentService } from "@/lib/gods-eye/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const availability = godsEyeAvailability();
    return NextResponse.json({
      ok: availability.available,
      ...availability,
      serviceRunning: Boolean(currentService()),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
