import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import {
  deleteArtifact,
  getArtifactForUser,
  presentArtifact,
  setArtifactHighlight,
  ArtifactStoreError,
} from "@/lib/hermes/artifact-store.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { isChatHighlight } from "@/lib/conversations/highlights.ts";

export const dynamic = "force-dynamic";

function conversationIdFrom(request: Request): string {
  const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim();
  if (!conversationId) throw new ApiError(400, "artifact_conversation_required", "conversationId is required.");
  return conversationId;
}

export async function GET(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const conversationId = conversationIdFrom(request);
    const { artifactId } = await params;
    const artifact = getArtifactForUser({ artifactId, userId, conversationPublicId: conversationId });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
    return NextResponse.json({ artifact: presentArtifact(artifact) });
  } catch (error) {
    if (error instanceof ArtifactStoreError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return apiErrorResponse(error);
  }
}

/**
 * PATCH: mark one artifact with a palette color, or clear the mark.
 *
 * Marking is an archive affordance and nothing else: it never reaches the
 * runtime, never touches the artifact's bytes, and never reorders the list.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const conversationId = conversationIdFrom(request);
    const { artifactId } = await params;
    const body = await readJsonBody(request);

    const artifact = getArtifactForUser({ artifactId, userId, conversationPublicId: conversationId });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);

    if (body.highlight === undefined) {
      throw new ApiError(400, "artifact_patch_empty", "Nothing to change.");
    }
    // null clears the mark. Anything else has to name a color in the shared
    // palette, so the archive can never be handed a slug it cannot paint.
    if (body.highlight !== null && !isChatHighlight(body.highlight)) {
      throw new ApiError(
        400,
        "invalid_highlight",
        "A highlight must be one of the palette colors, or null.",
      );
    }
    const marked = setArtifactHighlight({
      artifactId,
      userId,
      conversationPublicId: conversationId,
      highlight: body.highlight,
    });
    return NextResponse.json({ artifact: presentArtifact(marked) });
  } catch (error) {
    if (error instanceof ArtifactStoreError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const conversationId = conversationIdFrom(request);
    const { artifactId } = await params;
    // Ownership + garden access are enforced before anything is removed.
    const artifact = getArtifactForUser({ artifactId, userId, conversationPublicId: conversationId });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
    const deleted = await deleteArtifact({ artifactId, userId, conversationPublicId: conversationId });
    return NextResponse.json({ ok: true, artifact: deleted });
  } catch (error) {
    if (error instanceof ArtifactStoreError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return apiErrorResponse(error);
  }
}
