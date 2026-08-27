import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readWardrobeRuntimeStatus } from "@/lib/wardrobe/runtime-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const { availability, setup, service } = await readWardrobeRuntimeStatus({ userId });
    return NextResponse.json({
      ok: true,
      available: availability.available,
      reason: availability.reason ?? null,
      missing: availability.missing,
      // Whether a photo exists, never the photo and never a way to read it.
      setup,
      // The Runtime adapter may be awake for this check; this reports only the
      // Wardrobe/Vite child and gallery it owns.
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
