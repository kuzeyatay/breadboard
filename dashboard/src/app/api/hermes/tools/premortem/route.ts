import { NextResponse } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import {
  tokenAllows,
  verifyCapabilityToken,
} from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import {
  PremortemServiceError,
  runPremortem,
} from "@/lib/hermes/premortem-service.ts";
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
    if (
      !verified.ok ||
      !tokenAllows(verified.token, { tool: "premortem_run" })
    ) {
      throw new ApiError(
        403,
        "premortem_capability_denied",
        "Premortem access is not authorized.",
      );
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !==
        verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "premortem_session_scope_mismatch",
        "Premortem session scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "premortem_run_required",
        "Premortem requires a current chat run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes("premortem_run") ||
      !decision.selectedConditionalSkills.includes("premortem")
    ) {
      throw new ApiError(
        403,
        "premortem_skill_not_selected",
        "Select the first-party Premortem skill for this turn.",
      );
    }
    const body = await readJsonBody(request, 40 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const commandArguments = args.arguments;
    const commandName =
      Array.isArray(commandArguments) &&
      typeof commandArguments[0] === "string"
        ? commandArguments.slice(0, 2).join(" ").slice(0, 120)
        : "";
    recordAuditEvent({
      eventType: "premortem.command_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { runId: run.id, command: commandName },
    });
    const result = await runPremortem({
      arguments: commandArguments,
      workspaceDirectory: directoryForWorkspaceKey(
        readHermesConfig(),
        session.workspace_key,
      ),
      signal: request.signal,
    });
    recordAuditEvent({
      eventType: "premortem.command_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        command: commandName,
        exitCode: result.exitCode,
        ok: result.envelope.ok === true,
      },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "premortem.command_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof PremortemServiceError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "premortem_failed",
        },
      });
    }
    if (error instanceof PremortemServiceError) {
      const status =
        error.code === "premortem_runtime_unavailable"
          ? 503
          : error.code === "premortem_timeout"
            ? 504
            : error.code === "premortem_cancelled"
              ? 409
              : error.code === "premortem_invalid_response" ||
                  error.code === "premortem_launch_failed"
                ? 502
                : error.code === "premortem_command_denied" ||
                    error.code === "premortem_flag_denied"
                  ? 403
                  : 400;
      return apiErrorResponse(new ApiError(status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
