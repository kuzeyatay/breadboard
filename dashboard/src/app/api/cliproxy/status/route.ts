import { NextResponse } from "next/server";
import { readStatus } from "@/lib/cliproxy/management";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * Aggregate subscription state from Claude Code and the local proxy: which
 * backends are available, which accounts are signed in, and their models.
 */
export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json(await readStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
