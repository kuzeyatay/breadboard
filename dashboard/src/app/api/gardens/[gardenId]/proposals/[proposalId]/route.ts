import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import {
  getProposalById,
  setProposalStatus,
} from "@/lib/hermes/runtime-store.ts";
import { createGardenDocument } from "@/lib/garden-documents.ts";

export const dynamic = "force-dynamic";

// Apply or reject an agent proposal. Only the garden owner may decide. Applying
// is where a proposal becomes a real change — routed through Breadboard's own
// authoring paths, never a silent markdown overwrite by the agent. New-note
// proposals are written through the same canonical Garden document service as
// the authoring UI; other proposal kinds retain their existing decision path.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string; proposalId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { gardenId, proposalId } = await params;
    const access = authorizeGardenAccess(userId, gardenId);
    if (!access.isOwner) {
      throw new ApiError(403, "not_owner", "Only the garden owner can decide on proposals.");
    }

    const id = Number(proposalId);
    const proposal = getProposalById(id);
    if (!proposal || proposal.garden_id !== gardenId) {
      throw new ApiError(404, "proposal_not_found", "Proposal not found.");
    }
    if (proposal.status !== "pending") {
      throw new ApiError(409, "already_decided", "This proposal was already decided.");
    }

    const body = await readJsonBody(request);
    const decision = body.decision === "apply" ? "applied" : body.decision === "reject" ? "rejected" : null;
    if (!decision) {
      throw new ApiError(400, "invalid_decision", "decision must be apply or reject.");
    }

    const payload = JSON.parse(proposal.payload) as Record<string, unknown>;
    let document: Awaited<ReturnType<typeof createGardenDocument>> | null = null;
    if (decision === "applied" && proposal.kind === "note") {
      const title = typeof payload.title === "string" ? payload.title.trim() : "";
      const content = typeof payload.content === "string" ? payload.content : "";
      if (!title || !content.trim()) {
        throw new ApiError(
          400,
          "invalid_note_proposal",
          "This note proposal is missing its title or content.",
        );
      }
      document = await createGardenDocument({
        userId,
        clusterSlug: access.slug,
        title,
        content,
        folder: typeof payload.folder === "string" ? payload.folder : "",
        tags: Array.isArray(payload.tags)
          ? payload.tags.filter((tag): tag is string => typeof tag === "string")
          : ["assistant-response"],
      });
    }

    // A failed canonical write leaves the proposal pending and retryable.
    setProposalStatus(id, decision);

    // Incremental GBrain sync: after a proposal is APPLIED (a canonical write),
    // enqueue a re-index of the garden's derived retrieval state. Rejecting a
    // proposal enqueues nothing, so the index is left unchanged. The enqueue is
    // best-effort and never affects the canonical decision — a failure to index
    // only marks the source stale.
    if (decision === "applied") {
      try {
        const { enqueueGardenSync } = await import("@/lib/gbrain/sync.ts");
        enqueueGardenSync(access.clusterId, `proposal_${proposal.kind}_applied`);
        // Submit a bounded Runtime queue kick. No timer or indexer remains in
        // Next.js, and this is a no-op when GBrain is disabled.
        const { ensureSyncWorkerStarted } = await import("@/lib/gbrain/sync-worker.ts");
        ensureSyncWorkerStarted();
      } catch {
        // GBrain disabled/misconfigured must never block a proposal decision.
      }
    }

    return NextResponse.json({
      id,
      status: decision,
      // Return the reviewed payload and any canonical note created by Apply.
      payload,
      kind: proposal.kind,
      pageSlug: proposal.page_slug,
      document,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
