import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { getConversationForLegacyChatSession, getConversationForUser } from "@/lib/conversations/store.ts";
import { authorizeGardenAccess } from "@/lib/openharness/session-service.ts";
import { listArtifactsForUser, presentArtifact, ArtifactStoreError } from "@/lib/openharness/artifact-store.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const url = new URL(request.url);
    let conversationId = url.searchParams.get("conversationId")?.trim() || undefined;
    const legacyChatSessionId = Number(url.searchParams.get("chatSessionId"));
    if (!conversationId && Number.isInteger(legacyChatSessionId) && legacyChatSessionId > 0) {
      conversationId = getConversationForLegacyChatSession(legacyChatSessionId, userId).public_id;
    }
    const gardenSlug = url.searchParams.get("gardenSlug")?.trim() || undefined;
    if (conversationId) {
      const conversation = getConversationForUser(conversationId, userId);
      if (!['dashboard_terminal', 'garden_chat'].includes(conversation.surface)) {
        throw new ApiError(403, "artifacts_unavailable_on_surface", "Artifacts are not available on this surface.");
      }
    }
    if (gardenSlug) authorizeGardenAccess(userId, gardenSlug);
    const artifacts = listArtifactsForUser({ userId, conversationPublicId: conversationId, gardenSlug });
    for (const slug of new Set(artifacts.map((artifact) => artifact.garden_slug).filter((slug): slug is string => Boolean(slug)))) {
      authorizeGardenAccess(userId, slug);
    }
    return NextResponse.json({ artifacts: artifacts.map(presentArtifact) });
  } catch (error) {
    if (error instanceof ArtifactStoreError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return apiErrorResponse(error);
  }
}
