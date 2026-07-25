import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/openharness/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/openharness/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/openharness/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/openharness/run-store.ts";
import { authorizeTerminalCommand, runAuthorizedTerminalCommand } from "@/lib/openharness/terminal-execution.ts";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "terminal_execute_command" })) {
      throw new ApiError(403, "terminal_capability_denied", "Terminal execution is not authorized.");
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.surface !== "dashboard_terminal" ||
      runtimeExternalSessionId(session) !==
        verified.token.openHarnessSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "terminal_surface_denied", "Only an authenticated dedicated Terminal session may execute commands.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) throw new ApiError(409, "terminal_run_required", "A current Terminal run is required.");
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes("terminal_execute_command")
    ) {
      throw new ApiError(
        403,
        "terminal_turn_capability_denied",
        "Terminal execution is not authorized for the current turn.",
      );
    }
    const body = await readJsonBody(request, 16 * 1024);
    const command = typeof body.command === "string" ? body.command.trim() : "";
    const terminalScope = {
      workspaceRoot: session.active_directory ?? undefined,
      authorizedRoots: decision.authorizedRoots,
      authorizedDeleteTargets: decision.authorizedDeleteTargets ?? [],
    };
    const authorization = authorizeTerminalCommand(command, terminalScope);
    recordAuditEvent({
      eventType: authorization.allowed ? "terminal.command_authorized" : "terminal.command_denied",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        runId: run.id,
        category: authorization.category,
        reason: authorization.reason,
        commandFamily: command.split(/\s+/, 1)[0]?.slice(0, 80) ?? "",
        commandHash: createHash("sha256").update(command).digest("hex"),
      },
    });
    if (!authorization.allowed) {
      throw new ApiError(403, "terminal_command_denied", authorization.reason);
    }
    const result = await runAuthorizedTerminalCommand(command, {
      runtimeSessionId: session.id,
      signal: request.signal,
      ...terminalScope,
    });
    recordAuditEvent({
      eventType: "terminal.command_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: { runId: run.id, category: authorization.category, exitCode: result.exitCode, timedOut: result.timedOut },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "terminal.command_failed",
        runtimeSessionId,
        payload: { reason: error instanceof Error ? error.message : "terminal_failed" },
      });
    }
    return apiErrorResponse(error);
  }
}
