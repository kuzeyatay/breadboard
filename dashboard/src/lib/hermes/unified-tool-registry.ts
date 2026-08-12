import type { AgentRuntime } from "../agent-runtime/contracts.ts";
import { nangoActionSummariesForConnections } from "../nango/actions.ts";
import {
  COMPOSIO_RUNTIME_NAME,
  composioConnectedIntegrationSlugs,
} from "../composio/service.ts";
import {
  connectionToolAllowed,
  type CapabilityMode,
} from "./capability-policy.ts";
import {
  listMcpConnections,
  runtimeMcpConfig,
} from "./mcp-connections.ts";

export interface ConnectedAppTurnRegistry {
  connectionNames: string[];
  tools: Record<string, boolean>;
  systemContext: string;
  toolCount: number;
}

const EMPTY_CONNECTED_APP_REGISTRY: ConnectedAppTurnRegistry = {
  connectionNames: [],
  tools: {},
  systemContext: "",
  toolCount: 0,
};

/**
 * Resolve installed MCP servers and Breadboard-owned connected-app actions into the
 * single per-turn registry exposed to either agent runtime.
 *
 * Connected apps are deliberately not mounted as MCP servers: Breadboard owns
 * OAuth, encrypted credentials, typed action schemas, user isolation, policy
 * checks, and explicit write approvals.
 */
export async function connectedAppRegistryForTurn(input: {
  runtime: AgentRuntime;
  directory: string;
  userId: number;
  mode: CapabilityMode;
  /**
   * A super-agent turn: every connected tool is offered rather than only the
   * read-shaped ones. This is a visibility decision, not an authority one — the
   * write-approval gate lives at call time in the mcp route.
   */
  allowAllConnectionTools?: boolean;
}): Promise<ConnectedAppTurnRegistry> {
  const installedConnections = listMcpConnections(input.userId, true);
  for (const connection of installedConnections) {
    try {
      await input.runtime.addMcpConnection(
        input.directory,
        connection.slug,
        runtimeMcpConfig(connection),
        input.userId,
      );
    } catch {
      // One unavailable server must not hide another server or connected app.
    }
  }

  const tools: Record<string, boolean> = {};
  const connectionNames: string[] = [];
  const contextLines: string[] = [];
  let toolCount = 0;

  try {
    const discovery = await input.runtime.listCapabilities(
      input.directory,
      input.userId,
    );
    const connectedMcp = installedConnections
      .map((connection) => connection.slug)
      .filter((slug) => discovery.mcp[slug]?.status === "connected")
      .sort((left, right) => right.length - left.length);
    connectionNames.push(...connectedMcp);

    const toolsByConnection = new Map<string, string[]>(
      connectedMcp.map((slug) => [slug, []]),
    );
    for (const exposedTool of discovery.tools) {
      const connection = connectedMcp.find((slug) =>
        exposedTool.startsWith(`${slug}_`),
      );
      if (!connection) continue;
      const rawTool = exposedTool.slice(connection.length + 1);
      if (!rawTool) continue;
      const allowed =
        input.allowAllConnectionTools === true ||
        input.mode === "scoped_implementation" ||
        connectionToolAllowed(rawTool);
      tools[exposedTool] = allowed;
      if (allowed) toolsByConnection.get(connection)?.push(rawTool);
    }

    let visibleCount = 0;
    for (const connection of connectedMcp) {
      const allowed = toolsByConnection.get(connection) ?? [];
      toolCount += allowed.length;
      const visible = allowed.slice(0, Math.max(0, 100 - visibleCount));
      visibleCount += visible.length;
      if (!visible.length) continue;
      contextLines.push(
        `For Breadboard's mcp_call tool, use connection=${JSON.stringify(connection)} and one of these exact MCP tool names: ${visible.join(", ")}.`,
      );
    }
    if (toolCount > visibleCount) {
      contextLines.push(
        `${toolCount - visibleCount} additional installed-MCP tools remain available in the native runtime registry.`,
      );
    }
  } catch {
    // MCP discovery is independent from connected-app discovery below.
  }

  try {
    const connectedApps = await composioConnectedIntegrationSlugs(
      input.userId,
      false,
    );
    const actions = nangoActionSummariesForConnections(connectedApps);
    if (actions.length) {
      connectionNames.push(COMPOSIO_RUNTIME_NAME);
      tools.mcp_call = true;
      toolCount += actions.length;
      contextLines.push(
        `Connected app accounts (brokered by Composio): ${connectedApps.join(", ")}. Invoke their exact actions with Breadboard's mcp_call using connection=${JSON.stringify(COMPOSIO_RUNTIME_NAME)}, tool=<action name>, and args=<the listed arguments>.`,
      );
      for (const action of actions) {
        const target =
          action.fixedConnectionSlug ??
          `any connected app (set args.connection to one of: ${connectedApps.join(", ")})`;
        contextLines.push(
          `${action.name} [${action.risk}; ${target}] — ${action.description} Arguments: ${action.argumentDescription}`,
        );
      }
    }
  } catch {
    // A temporarily unavailable app connection must not hide MCP servers.
  }

  const uniqueConnections = [...new Set(connectionNames)];
  if (!uniqueConnections.length && toolCount === 0) {
    return EMPTY_CONNECTED_APP_REGISTRY;
  }
  return {
    connectionNames: uniqueConnections,
    tools,
    systemContext: [
      "The unified Breadboard registry includes local tools, installed MCP servers, and connected app actions available for this turn.",
      ...contextLines,
      "Use a connected action only when it is relevant to the user's request. Read actions may run under the current task policy. Every write or destructive connected-app action pauses for explicit user approval before Breadboard forwards it.",
    ].join("\n"),
    toolCount,
  };
}
