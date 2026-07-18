import os from "node:os";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import type { CommandHubItem } from "@/lib/openharness/commands.ts";
import {
  getOpenHarnessGateway,
  type OpenHarnessCapabilityDiscovery,
} from "@/lib/openharness/gateway.ts";
import { inspectGBrainState } from "@/lib/openharness/gbrain-status.ts";
import { listPrompts } from "@/lib/openharness/prompts.ts";
import {
  apiErrorResponse,
  requireEnabled,
} from "@/lib/openharness/route-helpers.ts";
import { listApprovedSkills } from "@/lib/openharness/skills.ts";
import { getOpenHarnessUserSettings } from "@/lib/openharness/runtime-store.ts";
import {
  listMcpConnections,
  runtimeMcpConfig,
} from "@/lib/openharness/mcp-connections.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const settings = getOpenHarnessUserSettings(userId);
    let discovery: OpenHarnessCapabilityDiscovery = { tools: [], mcp: {} };
    let runtimeError: string | undefined;
    const ownedConnections = listMcpConnections(userId);
    try {
      const gateway = getOpenHarnessGateway();
      const directory = gateway.managementDirectory(userId);
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
      discovery = await gateway.capabilityDiscovery(directory);
    } catch (error) {
      runtimeError =
        error instanceof Error ? error.message : "OpenHarness is unavailable.";
    }
    const skills: CommandHubItem[] = listApprovedSkills().map((skill) => ({
      ...skill,
      kind: "skill",
      installed: true,
    }));
    const prompts: CommandHubItem[] = listPrompts(userId).map((prompt) => ({
      id: prompt.id,
      kind: "prompt",
      slug: prompt.slug,
      name: prompt.title,
      description: `${prompt.category} prompt`,
      installed: true,
      enabled: true,
      healthy: true,
      favorite: prompt.favorite,
    }));
    const ownedSlugs = new Set(
      ownedConnections.map((connection) => connection.slug),
    );
    const mcp: CommandHubItem[] = Object.entries(discovery.mcp)
      .filter(([slug]) => ownedSlugs.has(slug) || slug === "gbrain")
      .map(([slug, status]) => ({
        id: `mcp:${slug}`,
        kind: "mcp",
        slug,
        name: slug,
        description:
          status.status === "connected"
            ? `${discovery.tools.filter((tool) => tool.startsWith(`${slug}_`)).length} available tools`
            : `Connection ${status.status.replaceAll("_", " ")}`,
        installed: true,
        enabled: status.status !== "disabled",
        healthy: status.status === "connected",
        unavailableReason:
          status.status === "failed"
            ? status.error
            : status.status === "connected"
              ? undefined
              : status.status.replaceAll("_", " "),
      }));
    for (const connection of ownedConnections) {
      const existing = mcp.find((item) => item.slug === connection.slug);
      if (existing) {
        existing.name = connection.displayName;
        existing.enabled = connection.enabled;
        continue;
      }
      mcp.push({
        id: `mcp:${connection.slug}`,
        kind: "mcp",
        slug: connection.slug,
        name: connection.displayName,
        description: `${connection.transport} MCP connection`,
        installed: true,
        enabled: connection.enabled,
        healthy: false,
        unavailableReason: runtimeError ?? "Saved but not connected",
      });
    }
    const memoryState = inspectGBrainState(discovery.mcp, discovery.tools);
    if (!mcp.some((item) => item.slug === "gbrain")) {
      mcp.unshift({
        id: "mcp:gbrain",
        kind: "mcp",
        slug: "gbrain",
        name: "GBrain",
        description: "Durable memory",
        installed: memoryState.installed,
        enabled: false,
        healthy: false,
        unavailableReason: memoryState.reason || "Not configured",
      });
    }
    return NextResponse.json({
      groups: { skills, mcp, prompts },
      runtime: { healthy: !runtimeError, error: runtimeError },
      system: {
        filesystemMode: settings.filesystemMode,
        activeDirectory: settings.lastActiveDirectory ?? os.homedir(),
        memoryHealthy: memoryState.healthy,
        memoryStatus: memoryState.healthy ? "Connected" : "Not configured",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
