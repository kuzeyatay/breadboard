// Downloading one of a run's deliverables.
//
// The bytes come from the workspace outbox through the OpenWork server rather
// than from the filesystem, so the server's own path containment applies in
// addition to the run-manager's check that the id is one this run produced.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readRunArtifact } from "@/lib/openwork/run-manager.ts";

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
    return new Response(new Uint8Array(artifact.bytes), {
      headers: {
        "content-type": artifact.contentType,
        "content-length": String(artifact.bytes.length),
        // Model-authored files are never rendered inline on the dashboard's own
        // origin; they download.
        "content-disposition": `attachment; filename="${artifact.path.split("/").pop() ?? "artifact"}"`,
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
