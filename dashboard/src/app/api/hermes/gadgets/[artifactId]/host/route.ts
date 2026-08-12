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
  authorizeGadgetObservation,
  GadgetServiceError,
  submitGadgetActionForApproval,
} from "@/lib/hermes/gadget-service.ts";
import { GadgetStoreError } from "@/lib/hermes/gadget-store.ts";
import { GadgetBindingError } from "@/lib/hermes/gadget-bindings.ts";

export const dynamic = "force-dynamic";

/**
 * The host bridge: the single door between a running gadget and Breadboard.
 *
 * The gadget never calls this itself — it has an opaque origin and no
 * credentials. It postMessages the embedder, which forwards here with the
 * user's own session. So this route authorizes the *person looking at the
 * gadget*, and the gadget's identity is the artifact id in the path.
 *
 * Two kinds, and they behave differently on purpose:
 *
 *   observe  performs the read now and returns the data
 *   act      queues the write and returns a simulation of it; nothing happened
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { artifactId } = await params;
    const body = await readJsonBody(request, 512 * 1024);

    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    if (!conversationId) {
      throw new ApiError(400, "gadget_conversation_required", "conversationId is required.");
    }
    // Ownership and conversation scope are re-checked on every call rather than
    // trusted from when the frame was mounted: a gadget left open in a tab must
    // stop working the moment its artifact stops being the user's.
    const artifact = getArtifactForUser({
      artifactId,
      userId,
      conversationPublicId: conversationId,
    });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
    if (artifact.renderer_id !== "gadget") {
      throw new ApiError(404, "gadget_not_found", "That artifact is not a gadget.");
    }

    const kind = body.kind === "observe" || body.kind === "act" ? body.kind : "";
    const binding = typeof body.binding === "string" ? body.binding.trim() : "";
    const operation = typeof body.operation === "string" ? body.operation.trim() : "";
    if (!kind || !binding || !operation) {
      throw new ApiError(
        400,
        "gadget_call_invalid",
        "kind, binding and operation are required.",
      );
    }

    if (kind === "observe") {
      const { result } = await authorizeGadgetObservation({
        artifactId,
        binding,
        operation,
        payload: body.payload,
      });
      return Response.json({ ok: true, result });
    }

    const queued = await submitGadgetActionForApproval({
      artifactId,
      binding,
      operation,
      payload: body.payload,
    });
    return Response.json({
      ok: true,
      result: {
        actionId: queued.actionId,
        status: queued.status,
        simulated: queued.simulated,
        outcome: queued.outcome,
        // Spelled out in the payload the gadget receives so generated code has
        // no excuse for telling the user the write already happened.
        applied: false,
      },
    });
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
    if (error instanceof GadgetBindingError) {
      return Response.json(
        { ok: false, error: error.message, code: error.code },
        { status: 400 },
      );
    }
    return apiErrorResponse(error);
  }
}
