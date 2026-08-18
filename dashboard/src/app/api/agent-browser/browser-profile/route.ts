import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  BrowserProfileError,
  awaitWindowClosed,
  closeSignInWindow,
  openSignInWindow,
  resetProfile,
} from "@/lib/agent-browser/browser-profile.ts";
import { hasActiveRun } from "@/lib/agent-browser/run-manager.ts";
import { browserProfileState } from "@/lib/agent-browser/service.ts";
import { agentBrowserErrorResponse, readBody } from "@/lib/agent-browser/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The shared browser profile behind the profile page's sign-in card: read its
 * state, open the agents' browser on it so a person can log into their own
 * apps, close that window again, or throw the whole profile away.
 */
export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json({ ok: true, profile: browserProfileState() });
  } catch (error) {
    return agentBrowserErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = await readBody(request);
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "open") {
      // A run already owns the profile; a second browser on the same directory
      // would only hand its arguments to the first and exit.
      if (hasActiveRun()) throw new BrowserProfileError(409, "run_in_progress");
      openSignInWindow(body.url);
    } else if (action === "close") {
      closeSignInWindow();
      await awaitWindowClosed();
    } else if (action === "reset") {
      if (hasActiveRun()) throw new BrowserProfileError(409, "run_in_progress");
      resetProfile();
    } else {
      throw new BrowserProfileError(400, "unknown_action");
    }

    return NextResponse.json({ ok: true, profile: browserProfileState() });
  } catch (error) {
    if (error instanceof BrowserProfileError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: error.status });
    }
    return agentBrowserErrorResponse(error);
  }
}
