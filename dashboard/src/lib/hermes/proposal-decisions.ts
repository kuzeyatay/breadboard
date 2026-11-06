import db from "../db.ts";
import { ApiError } from "./route-core.ts";
import { authorizeGardenAccess } from "./session-service.ts";
import { getProposalById, setProposalStatus } from "./runtime-store.ts";
import { createGardenDocument, reviseGardenDocument } from "../garden-documents.ts";

/** One authoring path for the review button and an owner's approval in chat. */
export async function decideGardenProposal(input: {
  userId: number;
  gardenId: string;
  proposalId: number;
  decision: unknown;
  conversationId?: number;
}) {
  const { userId, gardenId, proposalId: id } = input;
  const access = authorizeGardenAccess(userId, gardenId);
  if (!access.isOwner) throw new ApiError(403, "not_owner", "Only the garden owner can decide on proposals.");
  const proposal = getProposalById(id);
  if (!proposal || proposal.garden_id !== gardenId) throw new ApiError(404, "proposal_not_found", "Proposal not found.");
  if (input.conversationId !== undefined) {
    const owner = db.prepare(`SELECT conversation_id FROM conversation_messages WHERE id = ? AND role = 'assistant'`)
      .get(proposal.assistant_message_id) as { conversation_id: number } | undefined;
    if (proposal.created_by_user_id !== userId || owner?.conversation_id !== input.conversationId) {
      throw new ApiError(403, "proposal_scope_mismatch", "This proposal does not belong to the current chat.");
    }
  }
  const decision = input.decision === "apply" ? "applied" : input.decision === "reject" ? "rejected" : null;
  if (!decision) throw new ApiError(400, "invalid_decision", "decision must be apply or reject.");
  if (proposal.status === decision) return { id, status: decision, kind: proposal.kind, pageSlug: proposal.page_slug };
  if (proposal.status !== "pending") throw new ApiError(409, "already_decided", "This proposal was already decided.");
  const payload = JSON.parse(proposal.payload) as Record<string, unknown>;
  let document: Awaited<ReturnType<typeof createGardenDocument>> | null = null;
  if (decision === "applied" && proposal.kind === "note") {
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const content = typeof payload.content === "string" ? payload.content : "";
    if (!title || !content.trim()) throw new ApiError(400, "invalid_note_proposal", "This note proposal is missing its title or content.");
    document = await createGardenDocument({
      userId, clusterSlug: access.slug, title, content,
      preserveContent: payload.preserveContent === true,
      folder: typeof payload.folder === "string" ? payload.folder : "",
      tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string") : ["assistant-response"],
    });
  }
  if (decision === "applied" && proposal.kind === "page_revision") {
    document = await reviseGardenDocument({
      userId, clusterSlug: access.slug, pageSlug: proposal.page_slug ?? "",
      patchOrReplacement: typeof payload.patchOrReplacement === "string" ? payload.patchOrReplacement : "",
      originalText: typeof payload.originalText === "string" ? payload.originalText : undefined,
      teachingBaseHash: typeof payload.teachingBaseHash === "string" ? payload.teachingBaseHash : undefined,
    });
  }
  // A failed canonical write stays pending. Retries never apply a decided edit twice.
  setProposalStatus(id, decision);
  if (decision === "applied") {
    try {
      const { enqueueGardenSync } = await import("../gbrain/sync.ts");
      enqueueGardenSync(access.clusterId, `proposal_${proposal.kind}_applied`);
      const { ensureSyncWorkerStarted } = await import("../gbrain/sync-worker.ts");
      ensureSyncWorkerStarted();
    } catch { /* Indexing failure must not undo a canonical decision. */ }
  }
  return { id, status: decision, payload, kind: proposal.kind, pageSlug: proposal.page_slug, document };
}

/** Bounded, sequential decisions: report partial success and keep failed edits retryable. */
export async function decideGardenProposals(input: {
  userId: number; gardenId: string; conversationId: number;
  proposalIds: unknown; decision: unknown;
}) {
  if (!Array.isArray(input.proposalIds) || !input.proposalIds.length || input.proposalIds.length > 20 ||
      !input.proposalIds.every(id => Number.isSafeInteger(id) && id > 0)) {
    throw new ApiError(400, "invalid_proposal_ids", "Supply between 1 and 20 positive proposal IDs.");
  }
  const results = [];
  for (const proposalId of new Set<number>(input.proposalIds)) {
    try {
      const result = await decideGardenProposal({ ...input, proposalId });
      results.push({ id: result.id, status: result.status, kind: result.kind, pageSlug: result.pageSlug });
    } catch (error) {
      results.push({ id: proposalId, status: "failed", error: error instanceof Error ? error.message : "Proposal decision failed." });
    }
  }
  return { complete: results.every(result => result.status !== "failed"), results };
}
