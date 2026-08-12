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
import { RECALL_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import { isRecallError, RecallError, sanitizeRecallError } from "@/lib/recall/errors.ts";
import { getRecallSettings } from "@/lib/recall/settings.ts";
import {
  controlRecall,
  getRecallStatus,
  recallActivitySummary,
  recallFrameContext,
  recallMeetings,
  searchRecall,
  type RecallControlAction,
} from "@/lib/recall/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTROL_ACTIONS: readonly RecallControlAction[] = [
  "start",
  "stop",
  "start-audio",
  "stop-audio",
];

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Internal server-to-server endpoint for the Hermes `recall_*` tools. Not a
 * browser API: it authenticates with the same short-lived capability token the
 * gateway mints, which pins the user, the surface and the conversation.
 *
 * Reads are governed by the user's Recall settings — agent access can be
 * revoked in the settings tab and takes effect on the very next call, because
 * the check lives in the service rather than in tool registration. Control is
 * separate: unless the user has set it to always-allow, starting or stopping
 * capture answers 428 so the runtime asks them first.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 64 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!RECALL_TOOLS.includes(toolName as (typeof RECALL_TOOLS)[number])) {
      throw new ApiError(400, "recall_unknown_tool", "Unknown Recall tool.");
    }

    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "recall_capability_denied", "Recall is not authorized.");
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
      throw new ApiError(403, "recall_session_scope_mismatch", "Recall session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(403, "recall_tool_not_granted", "Recall is not available on this turn.");
    }

    const userId = session.user_id;
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    const data = await executeRecallTool({
      tool: toolName,
      userId,
      args,
      permissionGranted: body.permissionGranted === true,
    });

    recordAuditEvent({
      eventType: "recall.tool_completed",
      runtimeSessionId: session.id,
      userId,
      gardenId: session.garden_id,
      payload: { tool: toolName },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "recall.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          reason: isRecallError(error)
            ? error.code
            : error instanceof ApiError
              ? error.code
              : "recall_tool_failed",
        },
      });
    }
    if (isRecallError(error)) {
      const { code, message, status } = sanitizeRecallError(error);
      // 428 is the runtime's cue to ask the user and retry with permission.
      return NextResponse.json({ ok: false, error: message, code }, { status });
    }
    return apiErrorResponse(error);
  }
}

async function executeRecallTool(input: {
  tool: string;
  userId: number;
  args: Record<string, unknown>;
  permissionGranted: boolean;
}): Promise<unknown> {
  const { tool, userId, args } = input;

  switch (tool) {
    case "recall_status": {
      const status = await getRecallStatus(userId);
      return {
        capturing: status.reachable && status.health?.status !== "unhealthy",
        reachable: status.reachable,
        installed: status.install.installed,
        agentAccess: status.settings.agentAccess,
        frameStatus: status.health?.frameStatus ?? null,
        audioStatus: status.health?.audioStatus ?? null,
        lastFrameAt: status.health?.lastFrameTimestamp ?? null,
        lastAudioAt: status.health?.lastAudioTimestamp ?? null,
        excludedWindowCount: status.settings.excludedWindows.length,
        defaultLookbackHours: status.settings.defaultLookbackHours,
      };
    }
    case "recall_search":
      return searchRecall(
        userId,
        {
          query: stringArg(args, "query"),
          contentType:
            args.contentType === "screen" || args.contentType === "audio"
              ? args.contentType
              : "all",
          limit: numberArg(args, "limit"),
          startTime: stringArg(args, "startTime"),
          endTime: stringArg(args, "endTime"),
          appName: stringArg(args, "appName"),
          windowName: stringArg(args, "windowName"),
        },
        { forAgent: true },
      );
    case "recall_activity":
      return recallActivitySummary(
        userId,
        {
          startTime: stringArg(args, "startTime"),
          endTime: stringArg(args, "endTime"),
          appName: stringArg(args, "appName"),
        },
        { forAgent: true },
      );
    case "recall_meetings":
      return recallMeetings(
        userId,
        {
          query: stringArg(args, "query"),
          startTime: stringArg(args, "startTime"),
          endTime: stringArg(args, "endTime"),
          limit: numberArg(args, "limit"),
          meetingId: numberArg(args, "meetingId"),
          includeTranscript: args.includeTranscript === true,
        },
        { forAgent: true },
      );
    case "recall_frame_context": {
      const frameId = numberArg(args, "frameId");
      if (frameId === undefined) {
        throw new RecallError("invalid_input", { userMessage: "frameId is required." });
      }
      return recallFrameContext(userId, frameId, { forAgent: true });
    }
    case "recall_control": {
      const action = stringArg(args, "action");
      if (!action || !CONTROL_ACTIONS.includes(action as RecallControlAction)) {
        throw new RecallError("invalid_input", {
          userMessage: `action must be one of: ${CONTROL_ACTIONS.join(", ")}.`,
        });
      }
      const settings = getRecallSettings(userId);
      if (settings.agentControl === "never") {
        throw new RecallError("agent_access_disabled", {
          userMessage:
            "The agent is not allowed to start or stop Recall capture. Change this in Settings → Recall.",
          httpStatus: 403,
        });
      }
      if (settings.agentControl === "ask" && !input.permissionGranted) {
        throw new RecallError("recall_permission_required", {
          userMessage:
            action === "stop"
              ? "Stop recording your screen and audio?"
              : action === "stop-audio"
                ? "Stop recording audio?"
                : action === "start-audio"
                  ? "Start recording audio?"
                  : "Start recording your screen and audio?",
        });
      }
      return controlRecall(userId, action as RecallControlAction);
    }
    default:
      throw new RecallError("invalid_input", { detail: `unhandled tool ${tool}` });
  }
}
