import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  isLoopbackHostname,
  requestHostname,
} from "@/lib/speech/system-microphone-settings";
import { readSystemLocationViaRuntime } from "@/lib/runtime-v2/system-location-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Each read runs a Runtime job (about 5 s) and every page with the sun theme
// asks. The machine rarely moves, so reuse a found position for 15 minutes,
// the same maximum age the browser source accepts.
const FIX_TTL_MS = 15 * 60_000;
const recentFixes = new Map<number, { at: number; result: unknown }>();

/**
 * Where the computer running Breadboard is, according to its operating system.
 *
 * Signed in and loopback only, and for the same reason as the microphone
 * settings route: the answer describes the machine hosting the server, which is
 * the person's own machine exactly when they are the one browsing it. Served
 * over a network it would hand back the host's location for someone standing
 * somewhere else entirely.
 *
 * The page asks for this only when its own geolocation cannot answer — inside
 * the desktop shell, where Chromium has no geolocation provider at all.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    if (!isLoopbackHostname(requestHostname(request))) {
      return NextResponse.json(
        {
          state: "unsupported",
          reason: "Breadboard is not running on this computer, so it cannot read its location.",
        },
        { status: 400 },
      );
    }
    const recent = recentFixes.get(userId);
    if (recent && Date.now() - recent.at < FIX_TTL_MS) return NextResponse.json(recent.result);
    const result = await readSystemLocationViaRuntime({
      userId,
      signal: request.signal,
    });
    if (result.state === "available") recentFixes.set(userId, { at: Date.now(), result });
    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
