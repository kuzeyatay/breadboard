import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  isLoopbackHostname,
  openMicrophonePrivacyPage,
  requestHostname,
} from "@/lib/speech/system-microphone-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Open this machine's microphone privacy page.
 *
 * Signed in and loopback only: the window opens on the computer running the
 * server, which is the user's own machine exactly when they are the one
 * browsing it. There is nothing to pass in — the address is a per-platform
 * constant, never a caller-supplied URL.
 */
export async function POST(request: Request) {
  try {
    await requireUserId();
    if (!isLoopbackHostname(requestHostname(request))) {
      return NextResponse.json(
        {
          opened: false,
          uri: null,
          reason: "Breadboard is not running on this computer, so it cannot open its settings.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(await openMicrophonePrivacyPage());
  } catch (error) {
    return routeErrorResponse(error);
  }
}
