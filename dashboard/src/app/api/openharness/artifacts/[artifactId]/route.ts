import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { getArtifactForUser, presentArtifact, ArtifactStoreError } from "@/lib/openharness/artifact-store.ts";
import { authorizeGardenAccess } from "@/lib/openharness/session-service.ts";

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
    return NextResponse.json({ artifact: presentArtifact(artifact) });
  } catch (error) {
    if (error instanceof ArtifactStoreError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return apiErrorResponse(error);
  }
}
