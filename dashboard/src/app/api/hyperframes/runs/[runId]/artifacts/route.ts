// What a run produced, listed for the card.
//
// The live run is asked first, but a finished video outlives the process that
// made it: after a dashboard restart the in-memory run is gone while the
// workspace is still on disk, so ownership falls back to the workspace's own
// owner record and the files are re-scanned. That is what lets a video keep
// playing in an old transcript.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { liveArtifacts } from "@/lib/hyperframes/run-manager.ts";
import {
  requireWorkspaceOwner,
  scanArtifacts,
  WorkspaceError,
} from "@/lib/hyperframes/workspace.ts";

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
    if (live) return NextResponse.json({ ok: true, artifacts: live });
    requireWorkspaceOwner(userId, runId);
    return NextResponse.json({ ok: true, artifacts: scanArtifacts(runId) });
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
