import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { runtimeAvailability } from "@/lib/wardrobe/runtime.ts";
import { setupStatus } from "@/lib/wardrobe/setup.ts";
import { currentService } from "@/lib/wardrobe/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const availability = runtimeAvailability();
    const service = currentService();
    return NextResponse.json({
      ok: true,
      available: availability.available,
      reason: availability.reason ?? null,
      missing: availability.missing,
      // Whether a photo exists, never the photo and never a way to read it.
      setup: setupStatus(),
      // A service is only reported when one is already running; health never
      // starts the server, so opening a settings panel cannot cost a boot.
      service: service
        ? {
            running: true,
            galleryUrl: service.baseUrl,
            startedAt: new Date(service.startedAt).toISOString(),
          }
        : { running: false },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
