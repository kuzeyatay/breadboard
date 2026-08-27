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
  FactcheckRuntimeError,
  runFactcheckViaRuntime,
} from "@/lib/runtime-v2/factcheck-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "factcheck_run" })) {
      throw new ApiError(
        403,
        "factcheck_capability_denied",
        "Fact-check access is not authorized.",
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
        "factcheck_session_scope_mismatch",
        "Fact-check session scope is invalid.",
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
        "factcheck_conversation_scope_mismatch",
        "Fact-check conversation scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "factcheck_run_required",
        "Fact-checking requires a current chat run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes("factcheck_run") ||
      !decision.selectedConditionalSkills.includes("bullshit-detector")
    ) {
      throw new ApiError(
        403,
        "factcheck_skill_not_selected",
        "Select the first-party Bullshit Detector skill for this turn.",
      );
    }
    const body = await readJsonBody(request, 40 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const commandArguments = args.arguments;
    const commandName =
      Array.isArray(commandArguments) && typeof commandArguments[0] === "string"
        ? commandArguments[0].slice(0, 40)
        : "";
    recordAuditEvent({
      eventType: "factcheck.command_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { runId: run.id, command: commandName },
    });
    const result = await runFactcheckViaRuntime({
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
      eventType: "factcheck.command_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        command: result.command,
        exitCode: result.exitCode,
        outputBytes: result.outputBytes,
      },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "factcheck.command_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof FactcheckRuntimeError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "factcheck_failed",
        },
      });
    }
    if (error instanceof FactcheckRuntimeError) {
      return apiErrorResponse(new ApiError(error.status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
