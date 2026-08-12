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
import { OmhServiceError, runOmh } from "@/lib/hermes/omh-service.ts";
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
    if (!verified.ok || !tokenAllows(verified.token, { tool: "omh_run" })) {
      throw new ApiError(
        403,
        "omh_capability_denied",
        "oh-my-hermes access is not authorized.",
      );
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
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
        "omh_session_scope_mismatch",
        "oh-my-hermes session scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "omh_run_required",
        "oh-my-hermes requires a current chat run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes("omh_run") ||
      !decision.selectedConditionalSkills.includes("oh-my-hermes")
    ) {
      throw new ApiError(
        403,
        "omh_skill_not_selected",
        "Select the first-party oh-my-hermes skill for this turn.",
      );
    }
    const body = await readJsonBody(request, 40 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const commandArguments = args.arguments;
    // Only the command and subcommand are audited. The remaining positionals
    // carry the user's own message text on `chat route`, which belongs in the
    // conversation rather than duplicated into the audit log.
    const commandName =
      Array.isArray(commandArguments) && typeof commandArguments[0] === "string"
        ? commandArguments
            .slice(0, 2)
            .filter((value): value is string => typeof value === "string")
            .join(" ")
            .slice(0, 120)
        : "";
    recordAuditEvent({
      eventType: "omh.command_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { runId: run.id, command: commandName },
    });
    const result = await runOmh({
      arguments: commandArguments,
      workspaceDirectory: directoryForWorkspaceKey(
        readHermesConfig(),
        session.workspace_key,
      ),
      signal: request.signal,
    });
    recordAuditEvent({
      eventType: "omh.command_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        command: commandName,
        exitCode: result.exitCode,
        bytes: result.output.length,
      },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "omh.command_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof OmhServiceError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "omh_failed",
        },
      });
    }
    if (error instanceof OmhServiceError) {
      const status =
        error.code === "omh_runtime_unavailable"
          ? 503
          : error.code === "omh_timeout"
            ? 504
            : error.code === "omh_cancelled"
              ? 409
              : error.code === "omh_launch_failed" ||
                  error.code === "omh_empty_response" ||
                  error.code === "omh_command_failed"
                ? 502
                : error.code === "omh_command_denied" ||
                    error.code === "omh_flag_denied"
                  ? 403
                  : 400;
      return apiErrorResponse(new ApiError(status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
