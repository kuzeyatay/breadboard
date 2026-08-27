import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/ui-tars/service.ts";
import { uiTarsErrorResponse } from "@/lib/ui-tars/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Screenshots are served ONLY through this authenticated, ownership-checked
// route — never from an adapter URL, and never with a path the client controls
// beyond a numeric id (traversal-safe).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string; screenshotId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { agentId, runId, screenshotId } = await params;
    const png = await service.screenshot(userId, agentId, runId, screenshotId);
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
    return uiTarsErrorResponse(error);
  }
}
