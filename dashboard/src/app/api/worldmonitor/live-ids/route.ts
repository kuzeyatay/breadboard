import { NextResponse } from "next/server";

import { LIVE_CHANNELS, WEBCAM_FEEDS } from "@/lib/worldmonitor/live-streams";
import { normalizeHandle, resolveLiveIds } from "@/lib/worldmonitor/youtube-live";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Only handles this app already ships are resolvable — the route is not an
 *  open fetcher pointed at whatever a caller names. */
const KNOWN_HANDLES = new Set(
  [...LIVE_CHANNELS, ...WEBCAM_FEEDS].map((entry) => entry.handle.toLowerCase()),
);

/**
 * What each channel is streaming right now, so a tile plays the live broadcast
 * rather than the id that was live when the catalog was written.
 */
export async function GET(request: Request) {
  try {
    await requireUserId();

    const requested = (new URL(request.url).searchParams.get("handles") ?? "")
      .split(",")
      .map((value) => normalizeHandle(value))
      .filter((handle): handle is string => Boolean(handle))
      .filter((handle) => KNOWN_HANDLES.has(handle.toLowerCase()))
      .slice(0, 12);

    if (requested.length === 0) return NextResponse.json({ ids: {} });

    return NextResponse.json({ ids: await resolveLiveIds(requested) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
