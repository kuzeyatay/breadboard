import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { getArtifactForUser, ArtifactStoreError } from "@/lib/hermes/artifact-store.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import {
  getGadgetAction,
  retryGadgetAction,
  GadgetStoreError,
} from "@/lib/hermes/gadget-store.ts";
import {
  decideAndApply,
  GadgetServiceError,
  revertAppliedAction,
} from "@/lib/hermes/gadget-service.ts";

export const dynamic = "force-dynamic";

const DECISIONS = new Set(["approve", "reject", "revert", "retry"]);

/**
 * The user's decision on one queued action.
 *
 * Approving both records the decision and performs the write, because from the
 * user's side those are one act. They are separate underneath so that a write
 * which fails leaves a `failed` row they can retry, rather than looking like a
 * decision that never happened.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string; actionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { artifactId, actionId } = await params;
    const body = await readJsonBody(request, 64 * 1024);
    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    if (!conversationId) {
      throw new ApiError(400, "gadget_conversation_required", "conversationId is required.");
    }
    const artifact = getArtifactForUser({
      artifactId,
      userId,
      conversationPublicId: conversationId,
    });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);

    const decision = typeof body.decision === "string" ? body.decision : "";
    if (!DECISIONS.has(decision)) {
      throw new ApiError(
        400,
        "gadget_decision_invalid",
        "decision must be approve, reject, revert or retry.",
      );
    }

    // The action must belong to the gadget named in the path. Without this an
    // authorized user could decide another gadget's action by pairing their own
    // artifact id with someone else's action id.
    const existing = getGadgetAction(actionId);
    if (!existing || existing.gadgetArtifactId !== artifactId) {
      throw new ApiError(404, "gadget_action_not_found", "That action does not exist.");
    }

    if (decision === "revert") {
      const reverted = await revertAppliedAction({ actionId });
      return Response.json({ ok: true, result: reverted });
    }
    if (decision === "retry") {
      const requeued = retryGadgetAction({ actionId });
      return Response.json({ ok: true, result: { action: requeued } });
    }
    const action = await decideAndApply({
      actionId,
      decision: decision === "approve" ? "approved" : "rejected",
    });
    return Response.json({ ok: true, result: { action } });
  } catch (error) {
    if (
      error instanceof GadgetServiceError ||
      error instanceof GadgetStoreError ||
      error instanceof ArtifactStoreError
    ) {
      return Response.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}
