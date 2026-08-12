import { NextResponse } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getRuntimeSessionById,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import db from "@/lib/db";
import { presentArtifact, ArtifactStoreError } from "@/lib/hermes/artifact-store.ts";
import {
  GadgetServiceError,
  publishGadget,
  reviseGadget,
} from "@/lib/hermes/gadget-service.ts";
import { GadgetStoreError } from "@/lib/hermes/gadget-store.ts";
import { gadgetBindingCatalog } from "@/lib/hermes/gadget-bindings.ts";
import { gadgetHostApiReference } from "@/lib/hermes/gadget-runtime.ts";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["gadget_bindings", "gadget_generate", "gadget_revise"]);

export async function POST(request: Request) {
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    const body = await readJsonBody(request, 4 * 1024 * 1024);
    const action =
      typeof body.action === "string" && ACTIONS.has(body.action) ? body.action : "";
    if (!verified.ok || !action || !tokenAllows(verified.token, { tool: action })) {
      throw new ApiError(403, "gadget_capability_denied", "Gadget access is not authorized.");
    }
    const runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "gadget_session_scope_mismatch",
        "Gadget session scope is invalid.",
      );
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    // The binding catalog is a pure read of a static list, so it needs no run.
    // Requiring one would make the model unable to look up the API before it
    // has anything to publish.
    if (action === "gadget_bindings") {
      return NextResponse.json({
        ok: true,
        result: {
          bindings: gadgetBindingCatalog(),
          hostApi: gadgetHostApiReference(),
          contract: [
            "A read (`observe`) returns real data once Breadboard authorizes and records it.",
            "A write (`act`) is queued, simulated, and returns before it has happened.",
            "Only mark a binding writable when the gadget calls host.<name>.act on it.",
          ],
        },
      });
    }

    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(409, "gadget_run_required", "Gadget tools require a current run.");
    }
    const dispatch = parseRuntimeRunDispatch(run);
    const assistantMessage = dispatch.clientMessageId
      ? (db
          .prepare(
            `SELECT id FROM conversation_messages
              WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`,
          )
          .get(session.conversation_id, dispatch.clientMessageId) as
          | { id: number }
          | undefined)
      : undefined;

    if (action === "gadget_generate") {
      const { artifact, gadget } = publishGadget({
        userId: session.user_id,
        runtimeSessionId: session.id,
        hermesSessionId: runtimeExternalSessionId(session)!,
        conversationId: session.conversation_id,
        clusterId: session.cluster_id,
        runId: run.id,
        assistantMessageId: assistantMessage?.id ?? null,
        toolCallId: typeof body.toolCallId === "string" ? body.toolCallId : null,
        surface: session.surface as "dashboard_terminal" | "garden_chat",
        package: args.package,
      });
      return NextResponse.json({
        ok: true,
        result: {
          artifact: presentArtifact(artifact),
          title: gadget.manifest.title,
          bindings: gadget.manifest.bindings,
          // Restated on every publish so the model describes the gadget to the
          // user correctly rather than claiming its writes already work.
          note: gadget.manifest.bindings.some((binding) => binding.writable)
            ? "This gadget can request writes. Each one is queued and shown to the user with a simulation of what it would do; nothing happens until they approve it."
            : "This gadget only reads. It cannot change anything.",
        },
      });
    }

    const artifactId = typeof args.artifactId === "string" ? args.artifactId.trim() : "";
    if (!artifactId) {
      throw new ApiError(400, "gadget_artifact_id_required", "artifactId is required.");
    }
    const { artifact, gadget } = reviseGadget({
      artifactId,
      userId: session.user_id,
      package: args.package,
      runId: run.id,
      assistantMessageId: assistantMessage?.id ?? null,
    });
    return NextResponse.json({
      ok: true,
      result: {
        artifact: presentArtifact(artifact),
        title: gadget.manifest.title,
        version: artifact.current_version,
        bindings: gadget.manifest.bindings,
      },
    });
  } catch (error) {
    if (
      error instanceof GadgetServiceError ||
      error instanceof GadgetStoreError ||
      error instanceof ArtifactStoreError
    ) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}
