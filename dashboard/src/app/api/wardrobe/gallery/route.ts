import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { reopenWardrobeService } from "@/lib/wardrobe/runtime-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The gallery address in a completed transcript stays stable even after the
 * Runtime service's idle retention expires. Opening it reacquires the service,
 * restores the last sealed launch shape, and then sends the browser to the
 * clone's current ephemeral loopback origin.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    const service = await reopenWardrobeService({ userId });
    return NextResponse.redirect(service.baseUrl, { status: 307 });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "wardrobe_unavailable" },
      { status: 503 },
    );
  }
}
