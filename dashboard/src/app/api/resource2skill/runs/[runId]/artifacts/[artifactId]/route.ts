import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readArtifact } from "@/lib/resource2skill/runtime-run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INLINE = new Set(["image", "audio"]);

export async function GET(request: Request, { params }: { params: Promise<{ runId: string; artifactId: string }> }) {
  try {
    const userId = await requireUserId();
    const { runId, artifactId } = await params;
    const artifact = await readArtifact(userId, runId, artifactId);
    if (!artifact) throw new Error("artifact_not_found");
    const { record, stream } = artifact;
    const inline = INLINE.has(record.kind) && new URL(request.url).searchParams.get("download") !== "1";
    const headers = new Headers({
      "content-type": inline ? record.contentType : "application/octet-stream",
      "content-length": String(record.size),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=0, must-revalidate",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${record.name.replace(/["\\\r\n]/g, "")}"`,
    });
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    if (error instanceof RouteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    const status = error instanceof Error &&
      (error.message === "run_not_found" || error.message === "artifact_not_found") ? 404 : 500;
    return NextResponse.json({ ok: false, error: status === 404 ? "artifact_not_found" : "internal_error" }, { status });
  }
}
