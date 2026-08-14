import type { CommandHubItem } from "./commands.ts";
import type { HermesSurface } from "./config.ts";
import {
  RUNTIME_AGENT_PROFILES,
} from "./capability-combinations.ts";
import type { PublicAgencyAgent } from "./agency-agents-client.ts";
import { agencyAgentToken } from "./agency-agent-command.ts";

export interface DirectCommandGroups {
  skills: CommandHubItem[];
  mcp: CommandHubItem[];
  prompts: CommandHubItem[];
  agents: CommandHubItem[];
}

function agencyCommand(agent: PublicAgencyAgent): CommandHubItem {
  return {
    id: agent.id,
    kind: "agent",
    slug: agent.slug,
    token: agencyAgentToken(agent.slug),
    name: agent.name,
    description: agent.description,
    category: agent.divisionLabel,
    source: "Agency Agents",
    installed: true,
    enabled: true,
    healthy: true,
    division: agent.division,
    divisionLabel: agent.divisionLabel,
    divisionIcon: agent.divisionIcon,
    divisionColor: agent.divisionColor,
    emoji: agent.emoji,
    vibe: agent.vibe,
    services: agent.services,
    searchTerms: [
      agent.division,
      agent.divisionLabel,
      agent.vibe,
      ...agent.services.map((service) => service.name),
    ].filter(Boolean).join(" "),
  };
}

/**
 * Build the type-ahead list from capabilities that can run now. Catalog-only,
 * disabled, disconnected, unhealthy, or uninstalled entries stay in the full
 * capability manager and never leak into the direct slash-command menu.
 */
export function directSlashCommandItems({
  groups,
  agencyAgents = [],
  availableRuntimeAgentIds = [],
  surface,
  query = "",
}: {
  groups: DirectCommandGroups | null;
  agencyAgents?: PublicAgencyAgent[];
  availableRuntimeAgentIds?: string[];
  surface: HermesSurface;
  query?: string;
}): CommandHubItem[] {
  const availableAgents = new Set(availableRuntimeAgentIds);
  const runtimeAgents: CommandHubItem[] = RUNTIME_AGENT_PROFILES
    .filter((agent) =>
      agent.surfaces.includes(surface) && availableAgents.has(agent.id),
    )
    .map((agent) => ({
      id: `runtime-agent:${agent.id}`,
      kind: "agent",
      slug: agent.token,
      token: agent.token,
      name: agent.name,
      description: `Run this request with ${agent.name}.`,
      category: "Runtime agent",
      source: "Breadboard",
      installed: true,
      enabled: true,
      healthy: true,
    }));
  const candidates = [
    ...runtimeAgents,
    ...(groups?.skills ?? []),
    ...(groups?.agents ?? []),
    ...agencyAgents.map(agencyCommand),
    ...(groups?.mcp ?? []),
    ...(groups?.prompts ?? []),
  ];
  const normalizedQuery = query.trim().replace(/^\//, "").toLowerCase();
  const seenTokens = new Set<string>();
  return candidates.filter((item) => {
    if (item.installed === false || item.enabled === false || item.healthy === false) {
      return false;
    }
    const token = item.token.toLowerCase();
    if (seenTokens.has(token)) return false;
    const matches = !normalizedQuery || [
      token,
      item.name,
      item.description,
      item.category,
      item.searchTerms,
    ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    if (!matches) return false;
    seenTokens.add(token);
    return true;
  });
}
