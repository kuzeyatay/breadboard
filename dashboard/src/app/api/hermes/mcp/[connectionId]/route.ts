import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getAgentRuntime } from "@/lib/agent-runtime/runtime.ts";
import {
  deleteMcpConnection,
  getMcpConnection,
  publicMcpConnection,
  runtimeMcpConfig,
  setMcpConnectionEnabled,
} from "@/lib/hermes/mcp-connections.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";

export const dynamic = "force-dynamic";

function numericId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0)
    throw new ApiError(400, "invalid_mcp_id", "Invalid MCP connection id.");
  return id;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { connectionId } = await params;
    const id = numericId(connectionId);
    const body = await readJsonBody(request);
    const connection = getMcpConnection(userId, id);
    if (!connection)
      throw new ApiError(404, "mcp_not_found", "MCP connection not found.");
    const runtime = getAgentRuntime();
    const directory = runtime.managementDirectory(userId);
    if (body.action === "authenticate") {
      let auth: { authorizationUrl: string };
      try {
        auth = await runtime.startMcpAuthentication(
          directory,
          connection.slug,
          userId,
        ) as { authorizationUrl: string };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          409,
          "mcp_auth_failed",
          "Authentication could not start. Runtime details were redacted.",
        );
      }
      recordAuditEvent({
        eventType: "mcp.auth.started",
        userId,
        payload: { connectionId: id, slug: connection.slug },
      });
      return NextResponse.json({ authorizationUrl: auth.authorizationUrl });
    }
    if (body.action === "test") {
      let statuses;
      let discovery;
      try {
        statuses = await runtime.addMcpConnection(
          directory,
          connection.slug,
          runtimeMcpConfig(connection),
          userId,
        ) as Record<string, unknown>;
        discovery = await runtime.listCapabilities(directory, userId);
      } catch {
        throw new ApiError(
          409,
          "mcp_test_failed",
          "The MCP test failed. Runtime details were redacted to protect credentials.",
        );
      }
      return NextResponse.json({
        status: statuses[connection.slug],
        tools: discovery.tools.filter((tool) =>
          tool.startsWith(`${connection.slug}_`),
        ),
      });
    }
    if (typeof body.enabled !== "boolean")
      throw new ApiError(
        400,
        "invalid_mcp_update",
        "enabled or a supported action is required.",
      );
    setMcpConnectionEnabled(userId, id, body.enabled);
    const updated = getMcpConnection(userId, id)!;
    if (body.enabled) {
      await runtime
        .addMcpConnection(
          directory,
          connection.slug,
          runtimeMcpConfig(updated),
          userId,
        )
        .catch(() => null);
    } else {
      await runtime
        .setMcpConnectionConnected(
          directory,
          connection.slug,
          false,
          userId,
        )
        .catch(() => false);
    }
    recordAuditEvent({
      eventType: body.enabled ? "mcp.enabled" : "mcp.disabled",
      userId,
      payload: { connectionId: id, slug: connection.slug },
    });
    return NextResponse.json({ connection: publicMcpConnection(updated) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { connectionId } = await params;
    const id = numericId(connectionId);
    const connection = deleteMcpConnection(userId, id);
    if (!connection)
      throw new ApiError(404, "mcp_not_found", "MCP connection not found.");
    const runtime = getAgentRuntime();
    await runtime
      .setMcpConnectionConnected(
        runtime.managementDirectory(userId),
        connection.slug,
        false,
        userId,
      )
      .catch(() => false);
    recordAuditEvent({
      eventType: "mcp.removed",
      userId,
      payload: {
        connectionId: id,
        slug: connection.slug,
        externalDataDeleted: false,
      },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
