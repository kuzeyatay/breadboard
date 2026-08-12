import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import { getArtifactForUser, listArtifactVersions, ArtifactStoreError } from "@/lib/hermes/artifact-store.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim();
    if (!conversationId) throw new ApiError(400, "artifact_conversation_required", "conversationId is required.");
    const { artifactId } = await params;
    const artifact = getArtifactForUser({ artifactId, userId, conversationPublicId: conversationId });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
    const versions = listArtifactVersions(artifactId).map((version) => ({
      id: version.id,
      version: version.version,
      status: version.status,
      mimeType: version.mime_type,
      byteSize: version.byte_size,
      contentHash: version.content_hash,
      previewAvailable: Boolean(version.preview_location),
      downloadAvailable: version.status === "ready" && Boolean(version.output_location),
      metadata: safeObject(version.metadata_json),
      error: safeObject(version.error_json),
      createdAt: version.created_at,
      updatedAt: version.updated_at,
    }));
    return NextResponse.json({ versions });
  } catch (error) {
    if (error instanceof ArtifactStoreError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return apiErrorResponse(error);
  }
}

function safeObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
