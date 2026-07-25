import { NextResponse } from "next/server";
import {
  addProxyMcpConnection,
  callProxyMcpTool,
  proxyMcpTools,
} from "@/lib/agent-runtime/mcp-proxy.ts";
import { verifyCapabilityToken, tokenAllows } from "@/lib/openharness/capability-token.ts";
import {
  getMcpConnection,
  listMcpConnections,
  runtimeMcpConfig,
} from "@/lib/openharness/mcp-connections.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/openharness/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/openharness/run-store.ts";
import { capabilityForInternalToolRequest } from "@/lib/openharness/tool-service-auth.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/openharness/route-helpers.ts";

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
    throw new ApiError(400, "invalid_mcp_arguments", "MCP arguments must be an object.");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
    throw new ApiError(413, "mcp_arguments_too_large", "MCP arguments are too large.");
  }
  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "mcp_call" })) {
      throw new ApiError(403, "mcp_capability_denied", "MCP access is not authorized.");
    }
    const session = getRuntimeSessionById(
      Number(verified.token.breadboardSessionId),
    );
    if (
      !session ||
      session.runtime_kind !== "hermes" ||
      session.user_id === null ||
      session.conversation_id === null ||
      runtimeExternalSessionId(session) !== verified.token.openHarnessSessionId ||
      verified.token.userId !== session.user_id ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "mcp_session_scope_mismatch", "MCP session scope is invalid.");
    }
    if (!getActiveRuntimeRun(session.id)) {
      throw new ApiError(409, "mcp_run_required", "MCP tools require a current run.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision) {
      throw new ApiError(403, "mcp_decision_required", "The capability decision is unavailable.");
    }

    const body = await readJsonBody(request, 384 * 1024);
    const slug = text(body.connection, "connection", 48).toLowerCase();
    const tool = text(body.tool, "tool", 200);
    const args = objectArgs(body.args ?? {});
    if (!decision.selectedConnections.includes(slug)) {
      throw new ApiError(403, "mcp_connection_denied", "That connection was not selected for this turn.");
    }
    const connection = listMcpConnections(session.user_id, true).find(
      (candidate) => candidate.slug === slug,
    );
    if (!connection || !getMcpConnection(session.user_id, connection.id)) {
      throw new ApiError(404, "mcp_not_available", "That connection is unavailable.");
    }

    const statuses = await addProxyMcpConnection(
      session.user_id,
      slug,
      runtimeMcpConfig(connection),
    );
    if (statuses[slug]?.status !== "connected") {
      throw new ApiError(409, "mcp_not_connected", "That connection is not connected.");
    }
    const declared = proxyMcpTools(session.user_id, slug).find(
      (candidate) => candidate.name === tool,
    );
    if (!declared) {
      throw new ApiError(403, "mcp_tool_denied", "That MCP tool is not authorized.");
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
        connectionId: connection.id,
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
      });
      recordAuditEvent({
        eventType: "mcp.tool_completed",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: { connectionId: connection.id, slug, tool, success: true },
      });
      return NextResponse.json({ ok: true, data });
    } catch {
      recordAuditEvent({
        eventType: "mcp.tool_completed",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: { connectionId: connection.id, slug, tool, success: false },
      });
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
