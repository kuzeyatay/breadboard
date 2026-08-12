import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError } from "@/lib/hermes/route-helpers.ts";
import { getConversationForUser } from "@/lib/conversations/store.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { listPendingProposalsForConversation } from "@/lib/hermes/runtime-store.ts";

export const dynamic = "force-dynamic";

// Pending Garden proposals a conversation produced, so the chat that created a
// proposal can also review it. The per-garden reviewer (Garden Chat's Proposals
// tab) stays the full list; this endpoint answers only "what is still waiting
// from this conversation", which is what the Terminal has no other way to know.
//
// Deciding still happens on /api/gardens/[gardenId]/proposals/[proposalId],
// which enforces ownership and performs the canonical write.
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId")?.trim() || undefined;
    const gardenSlug = url.searchParams.get("gardenSlug")?.trim() || undefined;
    if (!conversationId && !gardenSlug) {
      throw new ApiError(
        400,
        "proposal_scope_required",
        "A conversation or Garden scope is required.",
      );
    }
    if (conversationId) {
      // Rejects a conversation that is not this user's.
      getConversationForUser(conversationId, userId);
    }
    if (gardenSlug) authorizeGardenAccess(userId, gardenSlug);

    const rows = listPendingProposalsForConversation({
      userId,
      conversationPublicId: conversationId ?? null,
      gardenId: gardenSlug ?? null,
    });

    const proposals = rows.flatMap((row) => {
      // Only the owner can decide; a proposal aimed at a garden this user no
      // longer owns is dropped rather than shown as an action that would 403.
      let isOwner = false;
      try {
        isOwner = authorizeGardenAccess(userId, row.garden_id).isOwner;
      } catch {
        return [];
      }
      if (!isOwner) return [];

      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      return [{
        id: row.id,
        kind: row.kind,
        gardenId: row.garden_id,
        gardenName: row.garden_name ?? row.garden_id,
        title: typeof payload.title === "string" ? payload.title : null,
        folder: typeof payload.folder === "string" ? payload.folder : "",
        pageSlug: row.page_slug,
        rationale: row.rationale,
        characters: typeof payload.content === "string" ? payload.content.length : 0,
        createdAt: row.created_at,
      }];
    });

    return NextResponse.json({ proposals });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
