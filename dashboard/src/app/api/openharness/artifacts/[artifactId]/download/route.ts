import fs from "node:fs";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { artifactFile, getArtifactForUser, ArtifactStoreError } from "@/lib/openharness/artifact-store.ts";
import { authorizeGardenAccess } from "@/lib/openharness/session-service.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId")?.trim();
    if (!conversationId) throw new ApiError(400, "artifact_conversation_required", "conversationId is required.");
    const { artifactId } = await params;
    const artifact = getArtifactForUser({ artifactId, userId, conversationPublicId: conversationId });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
    const requestedVersion = Number(url.searchParams.get("version") ?? artifact.current_version);
    if (!Number.isInteger(requestedVersion) || requestedVersion <= 0) throw new ApiError(400, "invalid_artifact_version", "A valid version is required.");
    const file = artifactFile({ artifact, version: requestedVersion, purpose: "download" });
    return new Response(fs.readFileSync(file.path), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${file.filename.replace(/["\r\n]/g, "-")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ArtifactStoreError) return new Response(JSON.stringify({ error: error.message, code: error.code }), { status: error.status, headers: { "Content-Type": "application/json" } });
    return apiErrorResponse(error);
  }
}
