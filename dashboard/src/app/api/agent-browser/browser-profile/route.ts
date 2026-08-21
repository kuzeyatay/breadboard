import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  BrowserProfileError,
  awaitWindowClosed,
  closeSignInWindow,
  openSignInWindow,
  resetProfile,
} from "@/lib/agent-browser/browser-profile.ts";
import { ensureOpenCliExtension } from "@/lib/agent-browser/opencli-extension.ts";
import { claimBreadboardProfile, readBridgeStatus } from "@/lib/agent-browser/opencli-profile.ts";
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
      // Fetch OpenCLI's extension first, so the window that opens is one the
      // agents can actually drive. This is the moment for it: the person is
      // opening the browser to sign into their accounts, which is precisely
      // the capability the extension exists to use. It is best-effort and
      // never blocks the window — an offline machine still gets a browser.
      await ensureOpenCliExtension();
      // Taken before the launch: the profile that appears afterwards is the
      // one we opened, and naming it is what stops the daemon refusing every
      // command with "Multiple Browser Bridge profiles are connected".
      const bridgeBefore = (await readBridgeStatus())?.contextIds ?? [];
      openSignInWindow(body.url);
      await claimBreadboardProfile({ before: bridgeBefore });
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
