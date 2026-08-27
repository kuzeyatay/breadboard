import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  isLoopbackHostname,
  requestHostname,
} from "@/lib/speech/system-microphone-settings";
import { readSystemLocationViaRuntime } from "@/lib/runtime-v2/system-location-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    return NextResponse.json(await readSystemLocationViaRuntime({
      userId,
      signal: request.signal,
    }));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
