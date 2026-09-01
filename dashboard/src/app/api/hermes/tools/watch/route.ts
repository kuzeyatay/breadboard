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
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import {
  runWatch,
  WatchServiceError,
} from "@/lib/hermes/watch-service.ts";
import { readHermesConfig } from "@/lib/hermes/config.ts";
import { directoryForWorkspaceKey } from "@/lib/hermes/workspace.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "watch_run" })) {
      throw new ApiError(403, "watch_capability_denied", "Watch access is not authorized.");
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      (session.surface !== "dashboard_terminal" &&
        session.surface !== "garden_chat") ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "watch_session_scope_mismatch", "Watch is available only in an authenticated Terminal or Garden Chat session.");
    }
    const conversation = db.prepare(
      "SELECT public_id FROM conversations WHERE id = ? AND user_id = ?",
    ).get(session.conversation_id, session.user_id) as
      | { public_id: string }
      | undefined;
    if (!conversation?.public_id) {
      throw new ApiError(403, "watch_conversation_scope_mismatch", "Watch conversation scope is invalid.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(409, "watch_run_required", "Watch requires a current authenticated chat run.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes("watch_run") ||
      !decision.selectedConditionalSkills.includes("watch")
    ) {
      throw new ApiError(403, "watch_skill_not_selected", "Select the first-party Watch skill for this turn.");
    }
    const body = await readJsonBody(request, 32 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const source = typeof args.source === "string" ? args.source.slice(0, 500) : "";
    recordAuditEvent({
      eventType: "watch.processing_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        runId: run.id,
        sourceKind: /^https?:\/\//i.test(source) ? "url" : "local_file",
        detail: typeof args.detail === "string" ? args.detail : "balanced",
      },
    });
    const result = await runWatch({
      userId: session.user_id,
      conversationId: conversation.public_id,
      args,
      workspaceRoot:
        session.active_directory ??
        directoryForWorkspaceKey(readHermesConfig(), session.workspace_key),
      signal: request.signal,
    });
    recordAuditEvent({
      eventType: "watch.processing_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        runId: run.id,
        durationMs: result.durationMs,
        frameCount: result.framePaths.length,
        analyzedFrameCount: result.analyzedFrameCount,
      },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "watch.processing_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof WatchServiceError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "watch_failed",
        },
      });
    }
    if (error instanceof WatchServiceError) {
      const status =
        error.code === "watch_runtime_unavailable"
          ? 503
          : error.code === "watch_timeout"
            ? 504
            : error.code === "watch_cancelled"
              ? 409
              : error.code === "watch_launch_failed" ||
                  error.code === "watch_processing_failed"
                ? 502
                : error.code === "watch_private_url_denied" ||
                    error.code === "watch_source_outside_workspace"
                  ? 403
                  : 400;
      return apiErrorResponse(new ApiError(status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
