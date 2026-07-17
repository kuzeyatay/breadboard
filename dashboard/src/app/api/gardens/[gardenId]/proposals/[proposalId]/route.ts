import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import { authorizeGardenAccess } from "@/lib/openharness/session-service.ts";
import {
  getProposalById,
  setProposalStatus,
} from "@/lib/openharness/runtime-store.ts";

export const dynamic = "force-dynamic";

// Apply or reject an agent proposal. Only the garden owner may decide. Applying
// is where a proposal becomes a real change — routed through Breadboard's own
// authoring paths, never a silent markdown overwrite by the agent. Here we mark
// the decision; the actual apply is performed by the existing markdown-edit /
// note-creation flows the dashboard already owns, keyed off the proposal payload.
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

    setProposalStatus(id, decision);
    return NextResponse.json({
      id,
      status: decision,
      // The payload is returned so the client can route an "apply" through the
      // existing authoring UI (markdown editor / note creation) with the user in
      // control of the final write.
      payload: JSON.parse(proposal.payload),
      kind: proposal.kind,
      pageSlug: proposal.page_slug,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
