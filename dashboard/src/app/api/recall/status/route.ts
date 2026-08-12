import { NextResponse } from "next/server";

import { getRecallStatus } from "@/lib/recall/service.ts";
import { recallErrorResponse } from "@/lib/recall/route-helpers.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Everything the Recall tab needs in one poll: install, process, health, settings. */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ status: await getRecallStatus(userId) });
  } catch (error) {
    return recallErrorResponse(error);
  }
}
