import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getAgentRuntime } from "@/lib/agent-runtime/runtime.ts";
import {
  listMcpConnections,
  parseMcpConfig,
  publicMcpConnection,
  runtimeMcpConfig,
  saveMcpConnection,
} from "@/lib/openharness/mcp-connections.ts";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/openharness/route-helpers.ts";
import { recordAuditEvent } from "@/lib/openharness/runtime-store.ts";

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
      for (const connection of listMcpConnections(userId, true)) {
        await runtime
          .addMcpConnection(
            directory,
            connection.slug,
            runtimeMcpConfig(connection),
            userId,
          )
          .catch(() => null);
      }
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
