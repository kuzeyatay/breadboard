import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { liveArtifacts } from "@/lib/resource2skill/run-manager.ts";
import { requireWorkspaceOwner, scanArtifacts, Resource2SkillWorkspaceError } from "@/lib/resource2skill/workspace.ts";

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
    if (error instanceof RouteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof Resource2SkillWorkspaceError) return NextResponse.json({ ok: false, error: error.code }, { status: error.code === "run_not_found" ? 404 : 400 });
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
