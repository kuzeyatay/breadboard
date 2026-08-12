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
  listAutoApprovalRules,
  listGadgetActions,
  listGadgetObservations,
  setAutoApprovalRule,
  GadgetStoreError,
} from "@/lib/hermes/gadget-store.ts";
import { GadgetServiceError } from "@/lib/hermes/gadget-service.ts";

export const dynamic = "force-dynamic";

async function authorizedGadget(
  request: Request,
  artifactId: string,
  conversationId: string | undefined,
) {
  const userId = await requireUserId();
  requireEnabled();
  if (!conversationId) {
    throw new ApiError(400, "gadget_conversation_required", "conversationId is required.");
  }
  const artifact = getArtifactForUser({
    artifactId,
    userId,
    conversationPublicId: conversationId,
  });
  if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
  if (artifact.renderer_id !== "gadget") {
    throw new ApiError(404, "gadget_not_found", "That artifact is not a gadget.");
  }
  void request;
  return { userId, artifact };
}

/**
 * Everything this gadget has done or asked to do: the queue, the audit of what
 * it read, and the kinds of action the user has stopped being asked about.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const { artifactId } = await params;
    const url = new URL(request.url);
    await authorizedGadget(
      request,
      artifactId,
      url.searchParams.get("conversationId")?.trim(),
    );
    const actions = listGadgetActions({ artifactId, limit: 200 });
    return Response.json({
      ok: true,
      result: {
        actions,
        pendingCount: actions.filter((action) => action.status === "pending").length,
        observations: listGadgetObservations({ artifactId, limit: 100 }),
        autoApprovals: listAutoApprovalRules({ artifactId }),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Turn auto-approval for one action kind on or off.
 *
 * This only ever *narrows* what gets asked about; it cannot widen what a gadget
 * may do. An action still has to carry `autoApprovable` from its own binding
 * before a rule here has any effect, which is why sending a message stays
 * manual no matter what rule exists.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const { artifactId } = await params;
    const body = await readJsonBody(request, 64 * 1024);
    await authorizedGadget(
      request,
      artifactId,
      typeof body.conversationId === "string" ? body.conversationId.trim() : undefined,
    );
    const tag = typeof body.actionKindTag === "string" ? body.actionKindTag.trim() : "";
    const label = typeof body.actionKindLabel === "string" ? body.actionKindLabel.trim() : tag;
    if (!tag) {
      throw new ApiError(400, "gadget_action_kind_required", "actionKindTag is required.");
    }
    setAutoApprovalRule({
      artifactId,
      actionKindTag: tag,
      actionKindLabel: label,
      enabled: body.enabled === true,
    });
    return Response.json({
      ok: true,
      result: { autoApprovals: listAutoApprovalRules({ artifactId }) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
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
