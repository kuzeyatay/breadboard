import { composioConfigured } from "../composio/client.ts";
import { apiAnythingRegistry, API_ANYTHING_CONNECTION } from "../api-anything/service.ts";
import { connectedAppUsageInstructions } from "./connected-app-context.ts";
import type { AgentRuntime } from "../agent-runtime/contracts.ts";
import { isUnguardedBambuConnection } from "../bambu/mcp-guard.ts";
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
import { MCP_INSTALLER_CONNECTION, MCP_INSTALLER_CONTEXT } from "./mcp-installer-context.ts";
import type { ConnectionCandidate } from "./connection-routing.ts";
import { DOORY_CONNECTION, dooryContext } from "../doory/context.ts";
import { VIDEO_STUDIO_CONNECTION, videoStudioContext } from "../timeline-studio/context.ts";
import { SPACES_PAGE_CONNECTION, spacesPageContext } from "../spaces/page-context.ts";
import { WORKSPACE_CONNECTION, WORKSPACE_CONTEXT, WORKSPACE_SKILLS_CONTEXT, SPACE_TEMPLATE_CONTEXT } from "./workspace-context.ts";

export interface ConnectedAppTurnRegistry {
  connectionNames: string[];
  tools: Record<string, boolean>;
  systemContext: string;
  toolCount: number;
  /** Each connection with the tools it offers this turn, for request routing (connection-routing.ts). */
  catalog: ConnectionCandidate[];
}

/** Prompt characters spent on full connected-app action entries per turn. */
const CONNECTED_ACTION_DETAIL_CHARACTERS = 6_000;

const EMPTY_CONNECTED_APP_REGISTRY: ConnectedAppTurnRegistry = {
  connectionNames: [],
  tools: {},
  systemContext: "",
  toolCount: 0,
  catalog: [],
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
  /** Defer optional server startup and remote account discovery until a tool needs them. */
  deferMcpConnections?: boolean;
}): Promise<ConnectedAppTurnRegistry> {
  // Spotify is a Breadboard-owned connected app with native tools and browser
  // playback. Ignore retired pilot-MCP rows left by older builds.
  const installedConnections = listMcpConnections(input.userId, true).filter(
    (connection) => connection.slug !== "spotify" && connection.slug !== API_ANYTHING_CONNECTION && !isUnguardedBambuConnection(connection),
  );
  for (const connection of input.deferMcpConnections ? [] : installedConnections) {
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

  const websiteApis = apiAnythingRegistry(input.userId);
  const tools: Record<string, boolean> = { ...websiteApis.tools };
  // The MCP installer is always on the table: "add an MCP for X" can come up in any chat.
  tools.mcp_call = true;
  // So is the Design editor: Bread drives it whenever an image or design is being made or changed.
  const connectionNames: string[] = [...websiteApis.connectionNames, MCP_INSTALLER_CONNECTION, WORKSPACE_CONNECTION, DOORY_CONNECTION, VIDEO_STUDIO_CONNECTION, SPACES_PAGE_CONNECTION];
  const contextLines: string[] = [websiteApis.systemContext, MCP_INSTALLER_CONTEXT, WORKSPACE_CONTEXT, WORKSPACE_SKILLS_CONTEXT, SPACE_TEMPLATE_CONTEXT, dooryContext(input.userId), videoStudioContext(input.userId), spacesPageContext(input.userId)];
  let toolCount = websiteApis.toolCount;
  const catalog: ConnectionCandidate[] = [];
  const displayName = (slug: string) => installedConnections.find((connection) => connection.slug === slug)?.displayName || slug;

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
      catalog.push({ slug: connection, name: displayName(connection), tools: allowed });
      toolCount += allowed.length;
      const visible = allowed.slice(0, Math.max(0, 100 - visibleCount));
      visibleCount += visible.length;
      if (!visible.length) continue;
      contextLines.push(
        `For Breadboard's mcp_call tool, use connection=${JSON.stringify(connection)} and one of these exact MCP tool names: ${visible.join(", ")}.`,
      );
    }
    if (toolCount - websiteApis.toolCount > visibleCount) {
      contextLines.push(
        `${toolCount - websiteApis.toolCount - visibleCount} additional installed-MCP tools remain available in the native runtime registry.`,
      );
    }
  } catch {
    // MCP discovery is independent from connected-app discovery below.
  }
  // A new chat can discover a saved server before its process starts.
  for (const connection of installedConnections) {
    if (connectionNames.includes(connection.slug)) continue;
    if (!input.deferMcpConnections && !connection.slug.startsWith("custom-")) continue;
    const name = connection.displayName || connection.slug;
    catalog.push({ slug: connection.slug, name, tools: [] });
    connectionNames.push(connection.slug);
    contextLines.push(`Saved MCP ${JSON.stringify(name)} is available on demand as connection=${JSON.stringify(connection.slug)}. Call mcp_call with this exact connection and tool="__breadboard_list_tools", args={} to discover its tools when needed.`);
  }

  if (input.deferMcpConnections) {
    // Configuration is local. Do not wait for the account broker or add its
    // entire action catalog to an ordinary spoken turn. Discovery and execution
    // still validate the current user, run, selected connection and approvals.
    if (composioConfigured()) {
      connectionNames.push(COMPOSIO_RUNTIME_NAME);
      tools.mcp_call = true;
      contextLines.push(
        `Connected-app actions are available on demand through mcp_call. When the user's task needs an external app, call connection=${JSON.stringify(COMPOSIO_RUNTIME_NAME)}, tool="__breadboard_list_tools", args={} to discover this user's currently connected apps, exact action names and argument schemas. This does not imply that any particular account is connected. Do not discover accounts for ordinary conversation.`,
      );
    }
  } else {
    try {
      const connectedApps = await composioConnectedIntegrationSlugs(
        input.userId,
        false,
      );
      const actions = nangoActionSummariesForConnections(connectedApps);
      for (const app of connectedApps) {
        catalog.push({
          slug: app,
          name: `${app} connected app, via connection ${COMPOSIO_RUNTIME_NAME}`,
          tools: actions.filter((action) => !action.fixedConnectionSlug || action.fixedConnectionSlug === app).map((action) => action.name),
        });
      }
      if (actions.length) {
        connectionNames.push(COMPOSIO_RUNTIME_NAME);
        tools.mcp_call = true;
        toolCount += actions.length;
        contextLines.push(
          `Connected app accounts: ${connectedApps.join(", ")}. Invoke their exact actions with Breadboard's mcp_call using connection=${JSON.stringify(COMPOSIO_RUNTIME_NAME)}, tool=<action name>, and args=<the listed arguments>.`,
        );
        contextLines.push(
          `A connected app with no action listed below has its own tools: call connection=${JSON.stringify(COMPOSIO_RUNTIME_NAME)}, tool="__breadboard_list_tools", args={} to get their exact names and arguments.`,
        );
        contextLines.push(...connectedAppUsageInstructions(connectedApps));
        // Full entries until the budget is spent, then names only: discovery
        // returns every action's description and arguments, so a long catalogue
        // costs one lookup instead of thousands of tokens on every turn.
        let detailBudget = CONNECTED_ACTION_DETAIL_CHARACTERS;
        const nameOnly: string[] = [];
        for (const action of actions) {
          const target =
            action.fixedConnectionSlug ??
            `any connected app (set args.connection to one of: ${connectedApps.join(", ")})`;
          const line = `${action.name} [${action.risk}; ${target}] — ${action.description} Arguments: ${action.argumentDescription}`;
          if (line.length <= detailBudget) {
            detailBudget -= line.length;
            contextLines.push(line);
          } else {
            detailBudget = 0;
            nameOnly.push(`${action.name} [${action.risk}]`);
          }
        }
        if (nameOnly.length) {
          contextLines.push(
            `Also callable, by exact name: ${nameOnly.join(", ")}. Before calling one of these, get its description and arguments with connection=${JSON.stringify(COMPOSIO_RUNTIME_NAME)}, tool="__breadboard_list_tools", args={}.`,
          );
        }
      }
    } catch {
      // A temporarily unavailable app connection must not hide MCP servers.
    }
  }

  const uniqueConnections = [...new Set(connectionNames)];
  if (!uniqueConnections.length && toolCount === 0) {
    return EMPTY_CONNECTED_APP_REGISTRY;
  }
  return {
    connectionNames: uniqueConnections,
    tools,
    systemContext: [
      ...(input.deferMcpConnections ? ["# connected_app_tools"] : []),
      "The unified Breadboard registry includes local tools, installed MCP servers, and connected app actions available for this turn.",
      ...contextLines,
      "Use a connected action only when it is relevant to the user's request. Read actions may run under the current task policy. Every write or destructive connected-app action pauses for explicit user approval before Breadboard forwards it.",
    ].join("\n"),
    toolCount,
    catalog,
  };
}
