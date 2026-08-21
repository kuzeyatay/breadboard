import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { abortRun, getRun } from "@/lib/max-research/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const userId = await requireUserId();
  const { runId } = await params;
  const stopped = abortRun(userId, runId);
  const run = getRun(userId, runId);
  if (!run) {
    return NextResponse.json({ ok: false, error: "run_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, stopped, run });
}
