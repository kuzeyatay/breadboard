import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readArtifact } from "@/lib/hyperframes/runtime-run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INLINE_KINDS = new Set(["video", "image", "audio"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string; artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId, artifactId } = await params;
    const artifact = await readArtifact(
      userId,
      runId,
      artifactId,
      request.headers.get("range"),
    );
    if (!artifact) {
      return NextResponse.json({ ok: false, error: "artifact_not_found" }, { status: 404 });
    }
    const download = new URL(request.url).searchParams.get("download") === "1";
    const inline = INLINE_KINDS.has(artifact.record.kind) && !download;
    const contentType = INLINE_KINDS.has(artifact.record.kind)
      ? artifact.record.contentType
      : "text/plain; charset=utf-8";
    const headers = new Headers({
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=0, must-revalidate",
      "accept-ranges": "bytes",
      "content-length": String(artifact.contentLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${artifact.record.name.replace(/["\\\\]/g, "")}"`,
    });
    if (artifact.contentRange) headers.set("content-range", artifact.contentRange);
    return new Response(artifact.stream, {
      status: artifact.contentRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const status = error instanceof Error && error.message === "run_not_found" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: status === 404 ? "run_not_found" : "internal_error" },
      { status },
    );
  }
}
