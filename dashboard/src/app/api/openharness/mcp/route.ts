import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
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
      const gateway = getOpenHarnessGateway();
      const directory = gateway.managementDirectory(userId);
      for (const connection of listMcpConnections(userId, true)) {
        await gateway
          .addMcpConnection(
            directory,
            connection.slug,
            runtimeMcpConfig(connection),
          )
          .catch(() => null);
      }
      const discovery = await gateway.capabilityDiscovery(directory);
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
    const gateway = getOpenHarnessGateway();
    let connectionStatus: unknown = {
      status: "failed",
      error:
        "Connection saved, but the runtime test failed. Secret-bearing error details were not exposed.",
    };
    try {
      const statuses = await gateway.addMcpConnection(
        gateway.managementDirectory(userId),
        connection.slug,
        runtimeMcpConfig(connection),
      );
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
