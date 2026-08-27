import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  BrowserProfileError,
  resetProfile,
} from "@/lib/agent-browser/browser-profile.ts";
import { ensureOpenCliExtension } from "@/lib/agent-browser/opencli-extension.ts";
import { hasActiveRun } from "@/lib/agent-browser/run-manager.ts";
import { browserProfileState } from "@/lib/agent-browser/service.ts";
import { agentBrowserErrorResponse, readBody } from "@/lib/agent-browser/route-helpers.ts";
import {
  closeAgentBrowserProfileWindow,
  openAgentBrowserProfileWindow,
} from "@/lib/runtime-v2/agent-browser-profile-job.ts";

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
    return NextResponse.json({ ok: true, profile: await browserProfileState() });
  } catch (error) {
    return agentBrowserErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readBody(request);
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "open") {
      // A run already owns the profile; a second browser on the same directory
      // would only hand its arguments to the first and exit.
      if (await hasActiveRun()) throw new BrowserProfileError(409, "run_in_progress");
      // Fetch OpenCLI's extension first, so the window that opens is one the
      // agents can actually drive. This is the moment for it: the person is
      // opening the browser to sign into their accounts, which is precisely
      // the capability the extension exists to use. It is best-effort and
      // never blocks the window — an offline machine still gets a browser.
      await ensureOpenCliExtension();
      await openAgentBrowserProfileWindow({ userId, url: body.url, signal: request.signal });
    } else if (action === "close") {
      await closeAgentBrowserProfileWindow({ userId, signal: request.signal });
    } else if (action === "reset") {
      if (await hasActiveRun()) throw new BrowserProfileError(409, "run_in_progress");
      resetProfile();
    } else {
      throw new BrowserProfileError(400, "unknown_action");
    }

    return NextResponse.json({ ok: true, profile: await browserProfileState() });
  } catch (error) {
    if (error instanceof BrowserProfileError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: error.status });
    }
    return agentBrowserErrorResponse(error);
  }
}
