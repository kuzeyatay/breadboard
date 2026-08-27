// Download one durable file named by the run's sealed Runtime projection. The
// disposable worker and Gateway may both be gone by the time this route runs.

import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readRunArtifact } from "@/lib/deer-flow/runtime-run-manager.ts";

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
    const body = Readable.toWeb(
      fs.createReadStream(artifact.absolutePath, { highWaterMark: 1024 * 1024 }),
    ) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        // Model-authored files are never rendered inline on the dashboard's own
        // origin; they download.
        "content-type": "application/octet-stream",
        "content-length": String(artifact.byteSize),
        "content-disposition": `attachment; filename="${artifact.filename}"`,
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
