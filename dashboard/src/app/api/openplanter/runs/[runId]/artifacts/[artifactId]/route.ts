import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readArtifact } from "@/lib/openplanter/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId, artifactId } = await params;
    const { record, content } = await readArtifact(userId, runId, artifactId);
    const safeName = record.name.replace(/["\r\n]/g, "_");
    return new Response(content.toString("utf8"), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `inline; filename="${safeName}"`,
        "cache-control": "private, max-age=60",
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const status =
      error instanceof Error &&
      (error.message === "run_not_found" || error.message === "artifact_not_found")
        ? 404
        : 500;
    return NextResponse.json({ ok: false, error: status === 404 ? "artifact_not_found" : "internal_error" }, { status });
  }
}
