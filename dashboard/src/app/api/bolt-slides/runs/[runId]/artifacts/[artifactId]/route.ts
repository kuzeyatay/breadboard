import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readArtifact } from "@/lib/bolt-slides/runtime-run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string; artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId, artifactId } = await params;
    const artifact = await readArtifact(userId, runId, artifactId);
    if (!artifact) {
      return NextResponse.json({ ok: false, error: "artifact_not_found" }, { status: 404 });
    }
    // These are the deck's sources, and a person opens them to read them. They
    // are served as plain text rather than by their own type — `index.html` is
    // the page shell, and rendering it would show an empty page that looks like
    // a broken deck instead of the file it is.
    const inline = new URL(request.url).searchParams.get("download") !== "1";
    const headers = new Headers({
      "content-type": inline ? "text/plain; charset=utf-8" : "application/octet-stream",
      "content-length": String(artifact.record.size),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=0, must-revalidate",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${artifact.record.name.replace(/["\r\n]/g, "")}"`,
    });
    return new Response(artifact.stream, { status: 200, headers });
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
