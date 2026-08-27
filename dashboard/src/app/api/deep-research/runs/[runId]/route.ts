import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getRun } from "@/lib/deep-research/runtime-run-manager.ts";
import { deepResearchErrorResponse } from "@/lib/deep-research/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { runId } = await params;
    const run = await getRun(userId, runId);
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return deepResearchErrorResponse(error);
  }
}
