// What a production produced, listed for the card, plus the production's own
// record of itself.
//
// The live run is asked first, but a finished video outlives the process that
// made it: after a dashboard restart the in-memory run is gone while the
// workspace is still on disk, so ownership falls back to the workspace's own
// owner record and both the files and the checkpoints are re-read. That is what
// lets a video keep playing — and its stage rail keep showing — in an old
// transcript.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { liveArtifacts } from "@/lib/openmontage/run-manager.ts";
import {
  readProductionState,
  requireWorkspaceOwner,
  scanArtifacts,
  WorkspaceError,
} from "@/lib/openmontage/workspace.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId } = await params;
    const live = liveArtifacts(userId, runId);
    if (live) {
      return NextResponse.json({
        ok: true,
        artifacts: live,
        production: readProductionState(runId),
      });
    }
    requireWorkspaceOwner(userId, runId);
    return NextResponse.json({
      ok: true,
      artifacts: scanArtifacts(runId),
      production: readProductionState(runId),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof WorkspaceError) {
      const status = error.code === "run_not_found" ? 404 : 400;
      return NextResponse.json({ ok: false, error: error.code }, { status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
