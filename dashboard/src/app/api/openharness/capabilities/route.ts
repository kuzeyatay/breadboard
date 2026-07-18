import os from "node:os";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import type { OpenHarnessMcpStatus } from "@/lib/openharness/client.ts";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { inspectGBrainState } from "@/lib/openharness/gbrain-status.ts";
import {
  getOpenHarnessUserSettings,
  successfulToolNamesForUser,
  type FilesystemAccessMode,
} from "@/lib/openharness/runtime-store.ts";
import { authorizeRuntimeSession } from "@/lib/openharness/session-service.ts";
import {
  apiErrorResponse,
  requireEnabled,
} from "@/lib/openharness/route-helpers.ts";
import {
  listMcpConnections,
  runtimeMcpConfig,
} from "@/lib/openharness/mcp-connections.ts";

export const dynamic = "force-dynamic";

const EXPECTED_TOOLS = [
  "read",
  "glob",
  "grep",
  "shell",
  "edit",
  "write",
  "patch",
  "task",
  "webfetch",
  "websearch",
  "skill",
  "garden_search",
  "capability_gap",
] as const;

function countServerTools(server: string, toolIds: string[]): number {
  const prefix = `${server.toLowerCase().replace(/[^a-z0-9_-]+/g, "_")}_`;
  return toolIds.filter((tool) => tool.toLowerCase().startsWith(prefix)).length;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const requestedSessionId = Number(
      new URL(request.url).searchParams.get("sessionId"),
    );
    const session =
      Number.isInteger(requestedSessionId) && requestedSessionId > 0
        ? authorizeRuntimeSession(userId, requestedSessionId)
        : null;
    const settings = getOpenHarnessUserSettings(userId);
    let toolIds: string[] = [];
    let mcp: Record<string, OpenHarnessMcpStatus> = {};
    let runtimeReason: string | undefined;
    const ownedConnections = listMcpConnections(userId);
    try {
      const gateway = getOpenHarnessGateway();
      const directory =
        session?.activeDirectory ?? gateway.managementDirectory(userId);
      if (!session) {
        for (const connection of ownedConnections.filter(
          (connection) => connection.enabled,
        )) {
          await gateway
            .addMcpConnection(
              directory,
              connection.slug,
              runtimeMcpConfig(connection),
            )
            .catch(() => null);
        }
      }
      const discovered = await gateway.capabilityDiscovery(directory);
      toolIds = discovered.tools;
      const ownedSlugs = new Set(
        ownedConnections.map((connection) => connection.slug),
      );
      mcp = Object.fromEntries(
        Object.entries(discovered.mcp).filter(
          ([slug]) => ownedSlugs.has(slug) || slug === "gbrain",
        ),
      );
    } catch (error) {
      runtimeReason =
        error instanceof Error
          ? error.message
          : "OpenHarness discovery failed.";
    }
    const filesystemMode: FilesystemAccessMode =
      session?.filesystemMode ?? settings.filesystemMode;
    const activeDirectory =
      session?.activeDirectory ?? settings.lastActiveDirectory ?? os.homedir();
    const toolSet = new Set(toolIds);
    const successfulTools = successfulToolNamesForUser(userId);
    const tools = EXPECTED_TOOLS.map((name) => {
      const aliases =
        name === "shell"
          ? ["shell", "bash"]
          : name === "webfetch"
            ? ["webfetch", "fetch"]
            : name === "websearch"
              ? ["websearch", "search"]
              : [name];
      const registered = aliases.some((alias) => toolSet.has(alias));
      const observedSuccessful = aliases.some((alias) =>
        successfulTools.has(alias),
      );
      const healthy =
        registered && (name !== "websearch" || observedSuccessful);
      const restrictedExternal =
        filesystemMode === "restricted" &&
        ["read", "glob", "grep"].includes(name);
      return {
        name,
        registered,
        permitted: registered,
        healthy,
        ...(registered
          ? name === "websearch" && !observedSuccessful
            ? {
                reason:
                  "Registered, but no successful web search has been observed for this user.",
              }
            : restrictedExternal
              ? { reason: "Available inside the isolated session directory." }
              : {}
          : {
              reason:
                runtimeReason ?? "The runtime did not register this tool.",
            }),
      };
    });
    const mcpServers = Object.entries(mcp).map(([name, status]) => ({
      name,
      configured: true,
      connected: status.status === "connected",
      authenticated:
        status.status !== "needs_auth" &&
        status.status !== "needs_client_registration",
      toolCount: countServerTools(name, toolIds),
      ...(status.status === "connected"
        ? {}
        : {
            reason:
              status.status === "failed" && status.error
                ? status.error
                : status.status.replaceAll("_", " "),
          }),
    }));
    const memory = inspectGBrainState(mcp, toolIds);
    if (!mcpServers.some((server) => server.name === "gbrain")) {
      mcpServers.unshift({
        name: "gbrain",
        configured: false,
        connected: false,
        authenticated: false,
        toolCount: 0,
        reason: "Not configured",
      });
    }
    return NextResponse.json({
      sessionId: session ? String(session.row.id) : "unbound",
      agent: session?.agentName ?? "breadboard-workbench",
      activeDirectory,
      filesystemMode,
      tools,
      mcpServers,
      memory,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
