import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { ensureService } from "@/lib/gods-eye/service.ts";
import { godsEyeShareHash, normalizeGodsEyeView } from "@/lib/gods-eye/view.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where a saved view lands. The dev server's port is chosen when it starts, so
 * the run card frames this URL — and the saved summary links to it — and is
 * redirected to wherever the server is now, started again if it is down. The
 * hash is rebuilt here from validated numbers, so nothing in the query can
 * steer the redirect anywhere but the local globe.
 */
export async function GET(request: Request) {
  try {
    await requireUserId();
    const url = new URL(request.url);
    const view = normalizeGodsEyeView({
      label: url.searchParams.get("label") ?? undefined,
      lat: Number(url.searchParams.get("lat")),
      lon: Number(url.searchParams.get("lon")),
      altM: Number(url.searchParams.get("alt")),
      headingDeg: Number(url.searchParams.get("heading")),
      pitchDeg: Number(url.searchParams.get("pitch")),
      style: url.searchParams.get("style") ?? undefined,
    });
    if (!view) {
      return NextResponse.json({ ok: false, error: "invalid_view" }, { status: 400 });
    }
    const service = await ensureService();
    // `welcome=0` keeps the clone's first-run mission card out of the frame.
    return NextResponse.redirect(
      `${service.baseUrl}/?welcome=0#${godsEyeShareHash(view)}`,
      302,
    );
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        ok: false,
        error: "gods_eye_service_unavailable",
        message:
          error instanceof Error ? error.message : "The God's Eye server could not be started.",
      },
      { status: 503 },
    );
  }
}
