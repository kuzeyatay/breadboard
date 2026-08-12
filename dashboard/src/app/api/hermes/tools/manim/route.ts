import { NextResponse } from "next/server";
import db from "@/lib/db";
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
import { presentArtifact } from "@/lib/hermes/artifact-store.ts";
import { MANIM_SKILL, MANIM_TOOL } from "@/lib/manim/identity.ts";
import {
  ManimServiceError,
  runManim,
  validateManimRequest,
} from "@/lib/manim/service.ts";
import { publishManimVideo } from "@/lib/manim/artifact.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: MANIM_TOOL })) {
      throw new ApiError(403, "manim_capability_denied", "Manim rendering is not authorized.");
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
        "manim_session_scope_mismatch",
        "Manim is available only in an authenticated chat session.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(409, "manim_run_required", "Manim rendering requires a current run.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes(MANIM_TOOL) ||
      !decision.selectedConditionalSkills.includes(MANIM_SKILL)
    ) {
      throw new ApiError(
        403,
        "manim_skill_not_selected",
        "Select the first-party Manim skill for this turn.",
      );
    }

    // JSON escaping can make a valid 64 KiB Python scene substantially larger
    // on the wire (newlines and backslashes are common in MathTex source).
    const body = await readJsonBody(request, 256 * 1024);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
    const manimRequest = validateManimRequest(args);
    recordAuditEvent({
      eventType: "manim.render_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        runId: run.id,
        sceneName: manimRequest.sceneName,
        quality: manimRequest.quality,
        sourceBytes: Buffer.byteLength(manimRequest.code, "utf8"),
      },
    });

    const result = await runManim(manimRequest, request.signal);
    const dispatch = parseRuntimeRunDispatch(run);
    const assistantMessage = dispatch.clientMessageId
      ? (db
          .prepare(
            `SELECT id FROM conversation_messages
             WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`,
          )
          .get(session.conversation_id, dispatch.clientMessageId) as { id: number } | undefined)
      : undefined;
    const artifact = publishManimVideo({
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
    });

    recordAuditEvent({
      eventType: "manim.render_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        runId: run.id,
        artifactId: artifact.id,
        quality: result.quality,
        durationSeconds: result.durationSeconds,
        sourceHash: result.sourceHash,
      },
    });
    return NextResponse.json({
      ok: true,
      data: {
        artifact: presentArtifact(artifact),
        sceneName: result.sceneName,
        quality: result.quality,
        durationSeconds: result.durationSeconds,
        runtimeImage: result.image,
      },
    });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "manim.render_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof ManimServiceError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "manim_render_failed",
        },
      });
    }
    if (error instanceof ManimServiceError) {
      const status = error.code === "manim_runtime_unavailable"
        ? 503
        : error.code === "manim_timeout"
          ? 504
          : error.code === "manim_invalid_arguments" || error.code === "manim_invalid_source"
            ? 400
            : 502;
      return apiErrorResponse(new ApiError(status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
