import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError } from "@/lib/hermes/route-helpers.ts";
import { getConversationForUser } from "@/lib/conversations/store.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { listPendingProposalsForConversation } from "@/lib/hermes/runtime-store.ts";
import { readGardenPage } from "@/lib/hermes/garden-reader.ts";
import { applyGardenRevision } from "@/lib/garden-revision.ts";

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

    const proposals = (await Promise.all(rows.map(async (row) => {
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
      const content = row.kind === "page_revision"
        ? (typeof payload.patchOrReplacement === "string" ? payload.patchOrReplacement : "")
        : (typeof payload.content === "string" ? payload.content : "");
      let previewContent: string | null = null;
      let previewError: string | null = null;
      // A patch may change only a line inside $$ delimiters. Render its result
      // against the current page so the surrounding math context stays intact.
      // This is a read-only preview; Apply still revalidates under the write lease.
      if (row.kind === "page_revision" && typeof payload.originalText !== "string") {
        try {
          if (!row.page_slug || !process.env.QUARTZ_CONTENT_PATH) throw new Error("Page unavailable");
          const { rawContent } = await readGardenPage(process.env.QUARTZ_CONTENT_PATH, row.garden_id, row.page_slug);
          if (rawContent === null) throw new Error("Page unavailable");
          previewContent = applyGardenRevision(rawContent, content)
            .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
        } catch {
          previewError = "This revision could not be previewed against the current page. The original patch is shown below.";
        }
      }
      return [{
        id: row.id,
        assistantMessageId: row.assistant_message_id == null ? null : `msg_${row.assistant_message_id}`,
        kind: row.kind,
        gardenId: row.garden_id,
        gardenName: row.garden_name ?? row.garden_id,
        title: typeof payload.title === "string" ? payload.title : null,
        folder: typeof payload.folder === "string" ? payload.folder : "",
        pageSlug: row.page_slug,
        rationale: row.rationale,
        content,
        previewContent,
        previewError,
        originalText: row.kind === "page_revision" && typeof payload.originalText === "string" ? payload.originalText : null,
        characters: content.length,
        createdAt: row.created_at,
      }];
    }))).flat();

    return NextResponse.json({ proposals });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
