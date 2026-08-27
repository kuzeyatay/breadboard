import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
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
  authorizeTerminalCommand,
  continueAuthorizedTerminalCommand,
  runAuthorizedTerminalCommand,
} from "@/lib/hermes/terminal-execution.ts";
import { createHash } from "node:crypto";
import { getConversationById } from "@/lib/conversations/store.ts";

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
      session.conversation_id === null ||
      session.surface !== "dashboard_terminal" ||
      runtimeExternalSessionId(session) !==
        verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "terminal_surface_denied", "Only an authenticated dedicated Terminal session may execute commands.");
    }
    const conversation = getConversationById(session.conversation_id);
    if (!conversation || conversation.user_id !== session.user_id) {
      throw new ApiError(
        403,
        "terminal_conversation_denied",
        "The Terminal conversation is unavailable.",
      );
    }
    const runtimeAuthority = {
      userId: session.user_id,
      gardenId: session.garden_id,
      conversationId: conversation.public_id,
    };
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
    // Collecting the rest of a command that outlived its slice. The handle was
    // minted by this server for this runtime session; the command itself was
    // authorized (and approved, when required) when it started, so it is not
    // re-authorized here — only re-checked for ownership by the execution layer.
    const commandId = typeof body.commandId === "string" ? body.commandId : "";
    if (commandId) {
      const continued = await continueAuthorizedTerminalCommand(commandId, {
        runtimeSessionId: session.id,
        runtimeAuthority,
        signal: request.signal,
      });
      if (!continued.running) {
        recordAuditEvent({
          eventType: "terminal.command_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          payload: {
            runId: run.id,
            category: "continued",
            exitCode: continued.exitCode,
            timedOut: continued.timedOut,
            elapsedMs: continued.elapsedMs,
          },
        });
      }
      return NextResponse.json({ ok: true, data: continued });
    }
    const command = typeof body.command === "string" ? body.command.trim() : "";
    // This flag is added only by the server-owned runtime wrappers after their
    // native permission request resolves. It is not part of either model tool
    // schema, so the model can choose the command but cannot self-approve it.
    const permissionGranted = body.permissionGranted === true;
    // The model sizes its own deadline in seconds; the execution layer clamps
    // that request into the operator's ceiling, so an absurd number costs
    // nothing and a missing one keeps the standing default.
    const requestedTimeoutSeconds =
      typeof body.timeoutSeconds === "number" ? body.timeoutSeconds : Number.NaN;
    const requestedMaxRuntimeMs = Number.isFinite(requestedTimeoutSeconds)
      ? requestedTimeoutSeconds * 1_000
      : undefined;
    const terminalScope = {
      workspaceRoot: session.active_directory ?? undefined,
      authorizedRoots: decision.authorizedRoots,
      authorizedDeleteTargets: decision.authorizedDeleteTargets ?? [],
      ...(permissionGranted ? { approvedCommand: command } : {}),
    };
    const authorization = authorizeTerminalCommand(command, terminalScope);
    recordAuditEvent({
      eventType: authorization.allowed
        ? "terminal.command_authorized"
        : authorization.approvalRequired
          ? "terminal.command_permission_requested"
          : "terminal.command_denied",
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
    if (!authorization.allowed && authorization.approvalRequired) {
      throw new ApiError(
        428,
        "terminal_permission_required",
        authorization.reason,
      );
    }
    if (!authorization.allowed) {
      throw new ApiError(403, "terminal_command_denied", authorization.reason);
    }
    const result = await runAuthorizedTerminalCommand(command, {
      runtimeSessionId: session.id,
      runtimeAuthority,
      signal: request.signal,
      ...terminalScope,
      ...(requestedMaxRuntimeMs !== undefined
        ? { maxRuntimeMs: requestedMaxRuntimeMs }
        : {}),
    });
    recordAuditEvent({
      eventType: result.running
        ? "terminal.command_running"
        : "terminal.command_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        runId: run.id,
        category: authorization.category,
        // The command family is the only part of the text the audit trail
        // keeps, and the turn's tool evidence is built from these rows.
        commandFamily: command.split(/\s+/, 1)[0]?.slice(0, 80) ?? "",
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        elapsedMs: result.elapsedMs,
        maxRuntimeMs: result.maxRuntimeMs,
      },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (
      runtimeSessionId !== null &&
      !(error instanceof ApiError && error.code === "terminal_permission_required")
    ) {
      recordAuditEvent({
        eventType: "terminal.command_failed",
        runtimeSessionId,
        payload: { reason: error instanceof Error ? error.message : "terminal_failed" },
      });
    }
    return apiErrorResponse(error);
  }
}
