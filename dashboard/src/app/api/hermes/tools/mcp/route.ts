import { NextResponse } from "next/server";
import {
  addProxyMcpConnection,
  callProxyMcpTool,
  LocalMcpBrokerError,
  proxyMcpTools,
} from "@/lib/agent-runtime/mcp-proxy.ts";
import {
  nangoActionFor,
} from "@/lib/nango/actions.ts";
import { COMPOSIO_RUNTIME_NAME } from "@/lib/composio/service.ts";
import { executeComposioAction } from "@/lib/composio/executor.ts";
import {
  verifyCapabilityToken,
  tokenAllows,
} from "@/lib/hermes/capability-token.ts";
import {
  getMcpConnection,
  listMcpConnections,
  runtimeMcpConfig,
} from "@/lib/hermes/mcp-connections.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import {
  getActiveRuntimeRun,
  parseRuntimeRunDispatch,
} from "@/lib/hermes/run-store.ts";
import {
  callGoalModeTool,
  GOAL_MODE_CONNECTION,
} from "@/lib/goal-mode.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { connectionToolAllowed } from "@/lib/hermes/capability-policy.ts";
import { getConversationById } from "@/lib/conversations/store.ts";

export const dynamic = "force-dynamic";

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_mcp_call", `${field} is required.`);
  }
  const result = value.trim();
  if (!result || result.length > max) {
    throw new ApiError(400, "invalid_mcp_call", `${field} is invalid.`);
  }
  return result;
}

function objectArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(
      400,
      "invalid_mcp_arguments",
      "Connected-app arguments must be an object.",
    );
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
    throw new ApiError(
      413,
      "mcp_arguments_too_large",
      "Connected-app arguments are too large.",
    );
  }
  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "mcp_call" })) {
      throw new ApiError(
        403,
        "mcp_capability_denied",
        "Connected-app access is not authorized.",
      );
    }
    const session = getRuntimeSessionById(
      Number(verified.token.breadboardSessionId),
    );
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      runtimeExternalSessionId(session) !==
        verified.token.hermesSessionId ||
      verified.token.userId !== session.user_id ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "mcp_session_scope_mismatch",
        "Connected-app session scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "mcp_run_required",
        "Connected-app tools require a current run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision) {
      throw new ApiError(
        403,
        "mcp_decision_required",
        "The capability decision is unavailable.",
      );
    }

    const body = await readJsonBody(request, 384 * 1024);
    const slug = text(body.connection, "connection", 48).toLowerCase();
    const tool = text(body.tool, "tool", 200);
    const args = objectArgs(body.args ?? {});
    // Added only by server-owned Hermes/Hermes wrappers after their
    // native approval UI resolves; it is absent from the model tool schema.
    const permissionGranted = body.permissionGranted === true;
    // Goal Mode is a built-in, conversation-scoped bridge. It deliberately
    // bypasses the saved-MCP registry: a generic local MCP process is shared by
    // user, while Goal state must be isolated to the exact conversation whose
    // signed capability token reached this route.
    if (slug === GOAL_MODE_CONNECTION) {
      const goalMode = parseRuntimeRunDispatch(run).goalMode;
      if (!goalMode?.enabled) {
        throw new ApiError(
          403,
          "goal_mode_disabled",
          "Goal Mode is not enabled for this turn.",
        );
      }
      if (!new Set(["get_goal", "create_goal", "update_goal"]).has(tool)) {
        throw new ApiError(403, "goal_tool_denied", "That Goal tool is not available.");
      }
      const conversation = getConversationById(session.conversation_id);
      if (!conversation) {
        throw new ApiError(403, "goal_conversation_missing", "Goal Mode conversation scope is invalid.");
      }
      recordAuditEvent({
        eventType: "goal_mode.tool_started",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: { runId: run.id, tool },
      });
      try {
        const result = callGoalModeTool({
          conversationPublicId: conversation.public_id,
          tool,
          args,
        });
        recordAuditEvent({
          eventType: "goal_mode.tool_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: { runId: run.id, tool, success: !result.isError },
        });
        return NextResponse.json({
          ok: true,
          data: {
            content: [{ type: "text", text: result.text }],
            ...(result.isError ? { isError: true } : {}),
          },
        });
      } catch {
        recordAuditEvent({
          eventType: "goal_mode.tool_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: { runId: run.id, tool, success: false },
        });
        throw new ApiError(502, "goal_tool_failed", "Goal Mode could not update its state.");
      }
    }
    if (!decision.selectedConnections.includes(slug)) {
      throw new ApiError(
        403,
        "mcp_connection_denied",
        "That connection was not selected for this turn.",
      );
    }

    if (slug === COMPOSIO_RUNTIME_NAME) {
      const action = nangoActionFor(tool);
      if (!action) {
        throw new ApiError(
          403,
          "connected_app_action_denied",
          "That connected-app action is not authorized.",
        );
      }
      if (!action.readOnly && !permissionGranted) {
        recordAuditEvent({
          eventType: "connected_app.action_permission_requested",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: {
            runId: run.id,
            action: action.name,
            connection: action.fixedConnectionSlug,
            risk: action.risk,
          },
        });
        throw new ApiError(
          428,
          "connected_app_permission_required",
          `${action.title} can change data in a connected account. Approve this exact action to continue.`,
        );
      }

      recordAuditEvent({
        eventType: "mcp.tool_started",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: {
          runId: run.id,
          connectionId: null,
          provider: "composio",
          slug,
          tool: action.name,
          risk: action.risk,
          approved: action.readOnly || permissionGranted,
        },
      });
      try {
        const data = await executeComposioAction({
          userId: session.user_id,
          action: action.name,
          args,
        });
        recordAuditEvent({
          eventType: "mcp.tool_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: {
            runId: run.id,
            connectionId: null,
            provider: "composio",
            slug,
            tool: action.name,
            success: true,
          },
        });
        return NextResponse.json({ ok: true, data });
      } catch (error) {
        recordAuditEvent({
          eventType: "mcp.tool_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: {
            runId: run.id,
            connectionId: null,
            provider: "composio",
            slug,
            tool: action.name,
            success: false,
          },
        });
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          502,
          "connected_app_action_failed",
          "The connected-app action failed. Provider details were redacted.",
        );
      }
    }

    const connection = listMcpConnections(session.user_id, true).find(
      (candidate) => candidate.slug === slug,
    );
    if (!connection || !getMcpConnection(session.user_id, connection.id)) {
      throw new ApiError(
        404,
        "mcp_not_available",
        "That connection is unavailable.",
      );
    }
    const config = runtimeMcpConfig(connection);
    const statuses = await addProxyMcpConnection(
      session.user_id,
      slug,
      config,
    );
    if (statuses[slug]?.status !== "connected") {
      throw new ApiError(
        409,
        "mcp_not_connected",
        "That connection is not connected.",
      );
    }
    const declared = proxyMcpTools(session.user_id, slug).find(
      (candidate) => candidate.name === tool,
    );
    if (!declared) {
      throw new ApiError(
        403,
        "mcp_tool_denied",
        "That MCP tool is not authorized.",
      );
    }
    if (
      decision.mode !== "scoped_implementation" &&
      !connectionToolAllowed(tool)
    ) {
      throw new ApiError(
        403,
        "mcp_side_effect_denied",
        "This MCP operation requires scoped implementation mode.",
      );
    }
    if (
      declared.annotations?.destructiveHint === true &&
      decision.mode !== "scoped_implementation"
    ) {
      throw new ApiError(
        403,
        "mcp_side_effect_denied",
        "This MCP operation requires scoped implementation mode.",
      );
    }

    recordAuditEvent({
      eventType: "mcp.tool_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        connectionId: connection.id,
        provider: "mcp",
        slug,
        tool,
        destructive: declared.annotations?.destructiveHint === true,
      },
    });
    try {
      const data = await callProxyMcpTool({
        userId: session.user_id,
        slug,
        tool,
        args,
        signal: request.signal,
      });
      recordAuditEvent({
        eventType: "mcp.tool_completed",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: {
          runId: run.id,
          connectionId: connection.id,
          provider: "mcp",
          slug,
          tool,
          success: true,
        },
      });
      return NextResponse.json({ ok: true, data });
    } catch (error) {
      recordAuditEvent({
        eventType: "mcp.tool_completed",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: {
          runId: run.id,
          connectionId: connection.id,
          provider: "mcp",
          slug,
          tool,
          success: false,
        },
      });
      if (error instanceof LocalMcpBrokerError) {
        if (error.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
          throw new ApiError(503, error.code, error.message);
        }
        if (error.code === "cancelled") {
          throw new ApiError(499, "mcp_tool_cancelled", "The MCP tool call was cancelled.");
        }
        if (error.code === "timeout") {
          throw new ApiError(504, "mcp_tool_timeout", "The MCP tool did not finish in time.");
        }
        if (error.code === "runtime_unavailable" || error.code === "unavailable") {
          throw new ApiError(503, "mcp_runtime_unavailable", "The local MCP runtime is unavailable.");
        }
      }
      throw new ApiError(
        502,
        "mcp_tool_failed",
        "The MCP tool failed. Sensitive runtime details were redacted.",
      );
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
