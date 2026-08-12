import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/agent-browser/service.ts";
import { getScreenshot } from "@/lib/agent-browser/run-manager.ts";
import { agentBrowserErrorResponse } from "@/lib/agent-browser/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string; screenshotId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { agentId, runId, screenshotId } = await params;
    // Ownership of the agent is enforced; runId is an unguessable random id and
    // screenshotId is digits-only (traversal-safe).
    service.requireAgent(userId, agentId);
    const png = await getScreenshot(runId, screenshotId);
    if (!png) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=60",
        "content-security-policy": "default-src 'none'; img-src 'self'",
      },
    });
  } catch (error) {
    return agentBrowserErrorResponse(error);
  }
}
