import { NextResponse } from "next/server";
import db from "@/lib/db";
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
  AgentLoopServiceError,
  validateAgentLoopRequestArguments,
} from "@/lib/hermes/agent-loop-request.ts";
import {
  AgentLoopRuntimeError,
  runAgentLoopViaRuntime,
} from "@/lib/runtime-v2/agent-loop-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function statusForCode(code: string): number {
  if (code === "agent_loop_runtime_unavailable") return 503;
  if (code === "agent_loop_timeout") return 504;
  if (code === "agent_loop_cancelled") return 409;
  if (code === "agent_loop_launch_failed") return 502;
  if (
    code === "agent_loop_command_denied" ||
    code === "agent_loop_flag_denied" ||
    code === "agent_loop_path_denied"
  ) {
    return 403;
  }
  return 400;
}

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (
      !verified.ok ||
      !tokenAllows(verified.token, { tool: "agent_loop_run" })
    ) {
      throw new ApiError(
        403,
        "agent_loop_capability_denied",
        "Agent loop kit access is not authorized.",
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
        "agent_loop_session_scope_mismatch",
        "Agent loop kit session scope is invalid.",
      );
    }
    const conversation = db.prepare(
      "SELECT public_id FROM conversations WHERE id = ? AND user_id = ?",
    ).get(session.conversation_id, session.user_id) as
      | { public_id: string }
      | undefined;
    if (!conversation?.public_id) {
      throw new ApiError(
        403,
        "agent_loop_conversation_scope_mismatch",
        "Agent loop kit conversation scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "agent_loop_run_required",
        "The loop kit requires a current chat run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes("agent_loop_run") ||
      !decision.selectedConditionalSkills.includes("agent-loop-engineering")
    ) {
      throw new ApiError(
        403,
        "agent_loop_skill_not_selected",
        "Select the Agent Loop Engineering skill for this turn.",
      );
    }
    const body = await readJsonBody(request, 16 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const commandArguments = validateAgentLoopRequestArguments(args.arguments).args;
    const commandName =
      Array.isArray(commandArguments) && typeof commandArguments[0] === "string"
        ? commandArguments[0].slice(0, 40)
        : "";
    recordAuditEvent({
      eventType: "agent_loop.command_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { runId: run.id, command: commandName },
    });
    const result = await runAgentLoopViaRuntime({
      scope: {
        userId: session.user_id,
        gardenId: session.garden_id,
        conversationId: conversation.public_id,
      },
      workspaceKey: session.workspace_key,
      arguments: commandArguments,
      signal: request.signal,
    });
    recordAuditEvent({
      eventType: "agent_loop.command_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        command: result.command,
        exitCode: result.exitCode,
      },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "agent_loop.command_failed",
        runtimeSessionId,
        payload: {
          reason:
            (error instanceof AgentLoopServiceError || error instanceof AgentLoopRuntimeError)
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "agent_loop_failed",
        },
      });
    }
    if (error instanceof AgentLoopRuntimeError) {
      return apiErrorResponse(
        new ApiError(error.status, error.code, error.message),
      );
    }
    if (error instanceof AgentLoopServiceError) {
      return apiErrorResponse(
        new ApiError(statusForCode(error.code), error.code, error.message),
      );
    }
    return apiErrorResponse(error);
  }
}
