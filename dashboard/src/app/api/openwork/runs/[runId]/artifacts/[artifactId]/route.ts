// Downloading one of a run's deliverables.
//
// The disposable worker copied the bytes into its fixed Runtime workspace.
// This route opens only the file named by the authenticated run's sealed event
// receipt, so downloads survive both a dashboard restart and service retirement.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readRunArtifact } from "@/lib/openwork/runtime-run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId, artifactId } = await params;
    const artifact = await readRunArtifact(userId, runId, artifactId);
    return new Response(artifact.stream, {
      headers: {
        "content-type": artifact.contentType,
        "content-length": String(artifact.size),
        // Model-authored files are never rendered inline on the dashboard's own
        // origin; they download.
        "content-disposition": `attachment; filename="${artifact.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "internal_error";
    const status = message === "run_not_found" || message === "artifact_not_found" ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
