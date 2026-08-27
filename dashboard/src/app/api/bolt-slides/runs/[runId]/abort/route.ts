import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { abortRun } from "@/lib/bolt-slides/runtime-run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { runId } = await params;
    return NextResponse.json({ ok: await abortRun(userId, runId) });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const status = error instanceof Error && error.message === "run_not_found" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: status === 404 ? "run_not_found" : "internal_error" },
      { status },
    );
  }
}
