import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  isLoopbackHostname,
  microphonePrivacyPageFallback,
  requestHostname,
} from "@/lib/speech/system-microphone-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Describe this machine's microphone privacy page for a plain browser.
 *
 * Electron uses its sender-checked desktop IPC and never reaches this route.
 * Signed-in loopback browsers receive only the fixed URI used by the manual
 * instructions; Next does not launch or detach an operating-system process.
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
    return NextResponse.json(microphonePrivacyPageFallback());
  } catch (error) {
    return routeErrorResponse(error);
  }
}
