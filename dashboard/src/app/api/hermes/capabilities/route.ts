import os from "node:os";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import type { RuntimeMcpStatus as HermesMcpStatus } from "@/lib/agent-runtime/contracts.ts";
import {
  getAgentRuntime,
  getAgentRuntimeByKind,
} from "@/lib/agent-runtime/runtime.ts";
import { inspectGBrainState } from "@/lib/hermes/gbrain-status.ts";
import {
  getHermesUserSettings,
  getActiveCapabilityDecision,
  successfulToolNamesForUser,
  type FilesystemAccessMode,
} from "@/lib/hermes/runtime-store.ts";
import { toolPolicyForDecision, decideCapabilityMode } from "@/lib/hermes/capability-policy.ts";
import { authorizeRuntimeReference } from "@/lib/hermes/session-service.ts";
import {
  apiErrorResponse,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import {
  listMcpConnections,
  runtimeMcpConfig,
} from "@/lib/hermes/mcp-connections.ts";

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
    const requestedSessionId = new URL(request.url).searchParams.get("sessionId");
    const session = requestedSessionId
      ? authorizeRuntimeReference(userId, requestedSessionId)
      : null;
    const settings = getHermesUserSettings(userId);
    const activeDecision = session
      ? getActiveCapabilityDecision(session.row.id)
      : null;
    const effectiveDecision = activeDecision ?? decideCapabilityMode({
      surface: session?.row.surface ?? "dashboard_terminal",
      userId,
      requestedOutcome: "Inspect available knowledge-work capabilities.",
      authorizedRoot: session?.activeDirectory ?? process.cwd(),
    });
    const policy = toolPolicyForDecision(effectiveDecision);
    let toolIds: string[] = [];
    let mcp: Record<string, HermesMcpStatus> = {};
    let runtimeReason: string | undefined;
    const ownedConnections = listMcpConnections(userId);
    try {
      const runtime = session
        ? getAgentRuntimeByKind(session.runtimeKind)
        : getAgentRuntime();
      const directory =
        session?.activeDirectory ?? runtime.managementDirectory(userId);
      if (!session) {
        for (const connection of ownedConnections.filter(
          (connection) => connection.enabled,
        )) {
          await runtime
            .addMcpConnection(
              directory,
              connection.slug,
              runtimeMcpConfig(connection),
              userId,
            )
            .catch(() => null);
        }
      }
      const discovered = await runtime.listCapabilities(directory, userId);
      toolIds = discovered.tools;
      const ownedSlugs = new Set(
        ownedConnections.map((connection) => connection.slug),
      );
      const discoveredMcp =
        typeof discovered.mcp === "object" && discovered.mcp !== null
          ? discovered.mcp as Record<string, HermesMcpStatus>
          : {};
      mcp = Object.fromEntries(
        Object.entries(discoveredMcp).filter(
          ([slug]) => ownedSlugs.has(slug) || slug === "gbrain",
        ),
      );
    } catch (error) {
      runtimeReason =
        error instanceof Error
          ? error.message
          : "Hermes discovery failed.";
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
        permitted: registered && policy[name === "shell" ? "bash" : name] !== false,
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
      sessionId: requestedSessionId ?? "unbound",
      agent: session?.agentName ?? "breadboard-assistant",
      capabilityMode: effectiveDecision.mode,
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
