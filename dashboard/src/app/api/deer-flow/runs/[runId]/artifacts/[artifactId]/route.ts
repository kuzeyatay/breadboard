// Downloading one of a run's produced files straight from the Gateway.
//
// The durable copy is the Breadboard artifact the run already stored; this is
// the live fallback for a file the artifact store would not take (an unusual
// binary, an oversized report), so the person can still get at it while the run
// is remembered. The bytes come through DeerFlow rather than off the filesystem,
// so its own path containment applies on top of the run manager's check that the
// id is one this run presented.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readRunArtifact } from "@/lib/deer-flow/run-manager.ts";

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
        // Model-authored files are never rendered inline on the dashboard's own
        // origin; they download.
        "content-type": "application/octet-stream",
        "content-length": String(artifact.bytes.length),
        "content-disposition": `attachment; filename="${artifact.path.split("/").pop() ?? "output"}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "internal_error";
    const status =
      message === "run_not_found" || message === "artifact_not_found" ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
