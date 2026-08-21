import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { liveArtifacts } from "@/lib/matraix/run-manager.ts";
import {
  MatraixWorkspaceError,
  requireWorkspaceOwner,
  scanArtifacts,
} from "@/lib/matraix/workspace.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { runId } = await params;
    const live = liveArtifacts(userId, runId);
    if (live) return NextResponse.json({ ok: true, artifacts: live });
    requireWorkspaceOwner(userId, runId);
    return NextResponse.json({ ok: true, artifacts: scanArtifacts(runId) });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof MatraixWorkspaceError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "run_not_found" ? 404 : 400 },
      );
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
