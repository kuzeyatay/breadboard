import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { liveArtifacts } from "@/lib/resource2skill/run-manager.ts";
import { requireWorkspaceOwner, resolveArtifact, Resource2SkillWorkspaceError } from "@/lib/resource2skill/workspace.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INLINE = new Set(["image", "audio"]);

export async function GET(request: Request, { params }: { params: Promise<{ runId: string; artifactId: string }> }) {
  try {
    const userId = await requireUserId();
    const { runId, artifactId } = await params;
    if (!liveArtifacts(userId, runId)) requireWorkspaceOwner(userId, runId);
    const { record, absolutePath } = resolveArtifact(runId, artifactId);
    const inline = INLINE.has(record.kind) && new URL(request.url).searchParams.get("download") !== "1";
    const headers = new Headers({
      "content-type": inline ? record.contentType : "application/octet-stream",
      "content-length": String(statSync(absolutePath).size),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=0, must-revalidate",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${record.name.replace(/["\\\r\n]/g, "")}"`,
    });
    const stream = Readable.toWeb(createReadStream(absolutePath)) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    if (error instanceof RouteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof Resource2SkillWorkspaceError) return NextResponse.json({ ok: false, error: error.code }, { status: error.code === "invalid_run_id" ? 400 : 404 });
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
