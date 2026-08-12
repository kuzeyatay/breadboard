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
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import { listRecentConversationMessages } from "@/lib/conversations/store.ts";
import { presentArtifact } from "@/lib/hermes/artifact-store.ts";
import db from "@/lib/db";
import {
  reconstructableImages,
  RECENT_MESSAGE_LOOKBACK,
  selectImage,
} from "@/lib/sf3d/images.ts";
import { parseSf3dOptions, runImageTo3d, Sf3dServiceError } from "@/lib/sf3d/service.ts";
import { publishReconstructedMesh } from "@/lib/sf3d/artifact.ts";
import { IMAGE_TO_3D_SKILL } from "@/lib/hermes/image-3d-intent.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reconstruct one attached picture into a 3D mesh.
 *
 * The picture is never taken from the request. The model names one, and the
 * bytes are resolved here out of a message in the caller's own conversation —
 * so the tool can only ever reconstruct something the person actually attached,
 * and no path, URL or data URL the model wrote is ever read.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "image_to_3d" })) {
      throw new ApiError(403, "image_to_3d_capability_denied", "3D reconstruction is not authorized.");
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      (session.surface !== "dashboard_terminal" && session.surface !== "garden_chat") ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "image_to_3d_session_scope_mismatch",
        "3D reconstruction is available only in an authenticated chat session.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(409, "image_to_3d_run_required", "3D reconstruction requires a current run.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes("image_to_3d") ||
      !decision.selectedConditionalSkills.includes(IMAGE_TO_3D_SKILL)
    ) {
      throw new ApiError(
        403,
        "image_to_3d_skill_not_selected",
        "Select the first-party Image to 3D skill for this turn.",
      );
    }

    const body = await readJsonBody(request, 8 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const reference = typeof args.image === "string" ? args.image.slice(0, 240) : undefined;
    const options = parseSf3dOptions(args);

    const images = reconstructableImages(
      listRecentConversationMessages(session.conversation_id, RECENT_MESSAGE_LOOKBACK),
    );
    if (images.length === 0) {
      throw new ApiError(
        400,
        "image_to_3d_no_image",
        "No picture is attached to this conversation. Ask the person to attach a JPEG, PNG or WebP.",
      );
    }
    const image = selectImage(images, reference);
    if (!image) {
      throw new ApiError(
        400,
        "image_to_3d_image_not_found",
        `No attached picture matches "${reference}". Attached: ${images.map((entry) => entry.name).join(", ")}.`,
      );
    }

    recordAuditEvent({
      eventType: "image_to_3d.reconstruction_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        runId: run.id,
        imageName: image.name,
        imageBytes: image.bytes.byteLength,
        textureResolution: options.textureResolution,
        remesh: options.remesh,
      },
    });

    const result = await runImageTo3d({
      image: image.bytes,
      imageName: image.name,
      options,
      signal: request.signal,
    });

    const dispatch = parseRuntimeRunDispatch(run);
    const assistantMessage = dispatch.clientMessageId
      ? (db
          .prepare(
            `SELECT id FROM conversation_messages
             WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`,
          )
          .get(session.conversation_id, dispatch.clientMessageId) as { id: number } | undefined)
      : undefined;

    const { artifact, summary } = publishReconstructedMesh({
      context: {
        userId: session.user_id,
        runtimeSessionId: session.id,
        hermesSessionId: runtimeExternalSessionId(session)!,
        conversationId: session.conversation_id,
        clusterId: session.cluster_id,
        surface: session.surface,
        runId: run.id,
        assistantMessageId: assistantMessage?.id ?? null,
        toolCallId: typeof body.toolCallId === "string" ? body.toolCallId.slice(0, 200) : null,
      },
      result,
      sourceImageName: image.name,
    });

    recordAuditEvent({
      eventType: "image_to_3d.reconstruction_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        runId: run.id,
        artifactId: artifact.id,
        durationSeconds: result.durationSeconds,
        device: result.device,
        ...(summary.triangles === undefined ? {} : { triangles: summary.triangles }),
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        artifact: presentArtifact(artifact),
        sourceImage: image.name,
        // Repeated in the payload the model reads, not only in the artifact
        // metadata, because the sentence it writes underneath is the only place
        // most people will ever see it.
        provenance:
          "Reconstructed from a single image by Stable Fast 3D; surfaces the picture does not show are inferred.",
        device: result.device,
        durationSeconds: result.durationSeconds,
        textureResolution: options.textureResolution,
        remesh: options.remesh,
        ...(result.peakMemoryMb === null ? {} : { peakMemoryMb: result.peakMemoryMb }),
        mesh: summary,
      },
    });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "image_to_3d.reconstruction_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof Sf3dServiceError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "image_to_3d_failed",
        },
      });
    }
    if (error instanceof Sf3dServiceError) {
      const status =
        error.code === "sf3d_runtime_unavailable" || error.code === "sf3d_runtime_incomplete"
          ? 503
          : error.code === "sf3d_timeout"
            ? 504
            : error.code === "sf3d_invalid_arguments" || error.code === "sf3d_invalid_image"
              ? 400
              : error.code === "sf3d_model_access_denied"
                ? 403
                : 502;
      return apiErrorResponse(new ApiError(status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
