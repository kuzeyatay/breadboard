import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { ArtifactStoreError, presentArtifact } from "@/lib/hermes/artifact-store.ts";
import { ensureTimelineStudio } from "@/lib/timeline-studio/server.ts";
import { markStudioSeen, studioClosed } from "@/lib/timeline-studio/context.ts";
import { setStudioTools } from "@/lib/timeline-studio/bridge.ts";
import { ownedMediaArtifact, saveExportAsVersion } from "@/lib/timeline-studio/tools.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown) {
  if (error instanceof ApiError) return apiErrorResponse(error);
  if (error instanceof ArtifactStoreError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Video Studio failed." }, { status: 503 });
}

/** Starts the editor's server if needed and tells the page which port to frame. */
export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json(await ensureTimelineStudio());
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 512 * 1024);
    if (body.action === "open") {
      const artifactId = typeof body.artifactId === "string" ? body.artifactId : null;
      const source = artifactId ? ownedMediaArtifact(userId, artifactId) : null;
      markStudioSeen(userId, source ? { artifactId: source.id, conversationId: String(body.conversationId ?? ""), title: source.title } : null);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "close") { studioClosed(userId); return NextResponse.json({ ok: true }); }
    if (body.action === "tools") {
      setStudioTools(userId, Array.isArray(body.tools) ? body.tools.slice(0, 64) : []);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "save") {
      const saved = await saveExportAsVersion(userId, String(body.exportId ?? ""), String(body.artifactId ?? ""));
      return NextResponse.json({ artifact: presentArtifact(saved) }, { status: 201 });
    }
    throw new ApiError(400, "video_studio_action", "Unknown action.");
  } catch (error) { return failure(error); }
}
