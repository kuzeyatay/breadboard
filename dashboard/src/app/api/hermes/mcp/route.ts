import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getAgentRuntime } from "@/lib/agent-runtime/runtime.ts";
import {
  listMcpConnections,
  parseMcpConfig,
  publicMcpConnection,
  runtimeMcpConfig,
  saveMcpConnection,
} from "@/lib/hermes/mcp-connections.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    requireEnabled();
    let statuses: Record<string, unknown> = {};
    let tools: string[] = [];
    try {
      const runtime = getAgentRuntime();
      const directory = runtime.managementDirectory(userId);
      // Settings polling is observational. A local MCP process starts only
      // for an explicit test/save or when a real turn selects the connection.
      const discovery = await runtime.listCapabilities(directory, userId);
      statuses = discovery.mcp;
      tools = discovery.tools;
    } catch {
      // Persisted configuration remains inspectable while the runtime is down.
    }
    return NextResponse.json({
      connections: listMcpConnections(userId).map((connection) => ({
        ...publicMcpConnection(connection),
        status: statuses[connection.slug] ?? { status: "not_loaded" },
        toolCount: tools.filter((tool) =>
          tool.startsWith(`${connection.slug}_`),
        ).length,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const parsed = parseMcpConfig(body);
    if (parsed.slug === "spotify") {
      throw new ApiError(
        409,
        "spotify_uses_connections",
        "Connect Spotify from Settings → Connections.",
      );
    }
    const connection = saveMcpConnection(userId, parsed);
    const runtime = getAgentRuntime();
    let connectionStatus: unknown = {
      status: "failed",
      error:
        "Connection saved, but the runtime test failed. Secret-bearing error details were not exposed.",
    };
    try {
      const statuses = await runtime.addMcpConnection(
        runtime.managementDirectory(userId),
        connection.slug,
        runtimeMcpConfig(connection),
        userId,
      ) as Record<string, unknown>;
      connectionStatus = statuses[connection.slug];
    } catch {
      recordAuditEvent({
        eventType: "mcp.test_failed",
        userId,
        payload: {
          connectionId: connection.id,
          slug: connection.slug,
          detailsRedacted: true,
        },
      });
    }
    recordAuditEvent({
      eventType: "mcp.saved",
      userId,
      payload: {
        connectionId: connection.id,
        slug: connection.slug,
        transport: connection.transport,
        approved: parsed.approved,
      },
    });
    return NextResponse.json(
      { connection: publicMcpConnection(connection), status: connectionStatus },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
