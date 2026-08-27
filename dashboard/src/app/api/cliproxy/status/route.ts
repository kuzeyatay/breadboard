import { NextResponse } from "next/server";
import { readStatus } from "@/lib/cliproxy/management";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * Aggregate subscription state from Claude Code and the local proxy: which
 * backends are available, which accounts are signed in, and their models.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    return NextResponse.json(await readStatus(userId, request.signal), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    return routeErrorResponse(error);
  }
}
