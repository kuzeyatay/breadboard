import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getRun } from "@/lib/max-research/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const userId = await requireUserId();
  const { runId } = await params;
  const run = getRun(userId, runId);
  if (!run) {
    return NextResponse.json({ ok: false, error: "run_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, run });
}
