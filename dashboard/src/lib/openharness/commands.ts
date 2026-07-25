import {
  outcomeWithoutCapabilityTokens,
  type CapabilityMode,
} from "./capability-policy.ts";
import type { OpenHarnessSurface } from "./config.ts";
import {
  getAgentRuntime,
  getAgentRuntimeByKind,
} from "../agent-runtime/runtime.ts";
import type {
  RuntimeCapabilities,
  RuntimeKind,
  RuntimeMcpStatus,
} from "../agent-runtime/contracts.ts";
import { resolvePrompt, listPrompts } from "./prompts.ts";
import {
  listApprovedSkills,
  type SkillEligibility,
} from "./skills.ts";
import { ApiError } from "./route-core.ts";
import {
  listMcpConnections,
  runtimeMcpConfig,
} from "./mcp-connections.ts";
import {
  findAgencyAgent,
  loadAgencyAgentsCatalog,
} from "./agency-agents.ts";

export type CommandHubItemKind = "skill" | "mcp" | "prompt" | "agent";

export interface CommandHubItem {
  id: string;
  kind: CommandHubItemKind;
  slug: string;
  token: string;
  name: string;
  description: string;
  content?: string;
  isDefault?: boolean;
  category?: string;
  source?: string;
  installed?: boolean;
  enabled?: boolean;
  healthy?: boolean;
  connected?: boolean;
  connectionTransport?: "remote" | "local";
  requiresApproval?: boolean;
  requiredCapabilityMode?: CapabilityMode;
  classification?: SkillEligibility;
  version?: string;
  contentHash?: string;
  unavailableReason?: string;
  favorite?: boolean;
  trustLabel?: string;
  division?: string;
  divisionLabel?: string;
  divisionIcon?: string;
  divisionColor?: string;
  emoji?: string;
  vibe?: string;
  services?: Array<{ name: string; url?: string; tier?: string }>;
  searchTerms?: string;
}

export interface CommandResolutionContext {
  mode: CapabilityMode;
  surface: OpenHarnessSurface;
  requestedOutcome?: string;
  runtimeKind?: RuntimeKind;
}

export interface ResolvedCommandMessage {
  text: string;
  userText: string;
  invocations: Array<{
    kind: CommandHubItemKind;
    slug: string;
    id: string;
    contentHash?: string;
  }>;
  tools?: Record<string, boolean>;
  agencyAgentSelection?:
    | { action: "set"; slug: string; id: string }
    | { action: "clear" };
}

const LEGACY_TOKEN = /^\/(skill|mcp|prompt|agent):([a-z0-9][a-z0-9_.-]*)(?:\s+|$)/i;
const CLEAN_TOKEN = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i;

function surfaceCompatibility(surface: OpenHarnessSurface): string {
  if (surface === "garden_chat") return "garden";
  if (surface === "quartz_ai") return "quartz";
  return "assistant";
}

export function skillAvailableForContext(
  skill: ReturnType<typeof listApprovedSkills>[number],
  context: CommandResolutionContext,
): boolean {
  if (!skill.enabled || !skill.healthy) return false;
  if (!skill.compatibleSurfaces.includes(surfaceCompatibility(context.surface) as never)) {
    return false;
  }
  return skill.classification === "eligible_general" && skill.availability === "ready";
}

export function assignCommandTokens<T extends { kind: CommandHubItemKind; slug: string }>(
  items: T[],
): Array<T & { token: string }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.slug, (counts.get(item.slug) ?? 0) + 1);
  return items.map((item) => ({
    ...item,
    token:
      item.kind === "agent"
        ? `agent:${item.slug}`
        : counts.get(item.slug) === 1
        ? item.slug
        : `${item.kind === "mcp" ? "connection" : item.kind}-${item.slug}`,
  }));
}

export function registryItemsForUser(
  userId: number | null,
  context: CommandResolutionContext,
): CommandHubItem[] {
  const skills: Omit<CommandHubItem, "token">[] = listApprovedSkills(context.surface)
    .filter((skill) => skillAvailableForContext(skill, context))
    .map((skill) => ({
      id: skill.id,
      kind: "skill",
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      source: skill.source ?? "Breadboard reviewed skill",
      installed: true,
      enabled: true,
      healthy: true,
      classification: skill.classification,
      requiredCapabilityMode: "knowledge",
      version: skill.version,
      contentHash: skill.contentHash,
      trustLabel: skill.contentHash ? "Reviewed and pinned" : "Reviewed installation",
    }));
  const connections: Omit<CommandHubItem, "token">[] = (userId === null ? [] : listMcpConnections(userId)).map(
    (connection) => ({
      id: `mcp:${connection.id}`,
      kind: "mcp",
      slug: connection.slug,
      name: connection.displayName,
      description:
        connection.transport === "remote"
          ? "Work with information from this connected service"
          : "Use this approved local connection",
      category: "Connection",
      source: connection.transport === "remote" ? "Remote MCP" : "Local MCP",
      connectionTransport: connection.transport,
      installed: true,
      enabled: connection.enabled,
      healthy: connection.enabled,
      connected: false,
      requiredCapabilityMode: "knowledge",
      trustLabel: connection.approvedAt ? "Approved" : "Setup required",
    }),
  );
  const prompts: Omit<CommandHubItem, "token">[] = (userId === null ? [] : listPrompts(userId)).map((prompt) => ({
    id: prompt.id,
    kind: "prompt",
    slug: prompt.slug,
    name: prompt.title,
    description: prompt.content.replace(/\s+/g, " ").slice(0, 110),
    content: prompt.content,
    isDefault: prompt.isDefault,
    category: prompt.category,
    source: prompt.isDefault ? "Breadboard" : "Your prompt",
    installed: true,
    enabled: true,
    healthy: true,
    requiredCapabilityMode: "knowledge",
    favorite: prompt.favorite,
  }));
  const agents: Omit<CommandHubItem, "token">[] =
    context.surface === "quartz_ai"
      ? []
      : loadAgencyAgentsCatalog().agents.map((agent) => ({
          id: agent.id,
          kind: "agent",
          slug: agent.slug,
          name: agent.name,
          description: agent.description,
          category: agent.divisionLabel,
          source: "Agency Agents",
          installed: true,
          enabled: true,
          healthy: true,
          requiredCapabilityMode: "knowledge",
          trustLabel: "Local persona",
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
            ...agent.services.map((service) => `${service.name} ${service.tier ?? ""}`),
          ].filter(Boolean).join(" "),
        }));
  return assignCommandTokens([...skills, ...connections, ...prompts, ...agents]);
}

export function mcpToolSelection(
  discovery: RuntimeCapabilities,
  slug: string,
): { selected: string[]; tools: Record<string, boolean> } {
  const prefix = `${slug.replace(/[^a-z0-9_-]+/g, "_")}_`.toLowerCase();
  const selected = discovery.tools.filter((tool) =>
    tool.toLowerCase().startsWith(prefix),
  );
  const mcpPrefixes = Object.keys(discovery.mcp).map((server) =>
    `${server.replace(/[^a-z0-9_-]+/g, "_")}_`.toLowerCase(),
  );
  const mcpTools = discovery.tools.filter((tool) =>
    mcpPrefixes.some((candidate) => tool.toLowerCase().startsWith(candidate)),
  );
  return {
    selected,
    tools: Object.fromEntries(
      mcpTools.map((tool) => [tool, selected.includes(tool)]),
    ),
  };
}

function promptRequestsImplementation(value: string): boolean {
  return (
    /\b(add|build|code|edit|fix|implement|modify|patch|refactor|repair|update)\b/i.test(value) &&
    /\b(api|code|component|file|repository|software|source|test|ui)\b/i.test(value)
  );
}

function requestedSelectors(
  rawText: string,
  registry: CommandHubItem[],
): { requested: Array<{ kind: CommandHubItemKind; slug: string }>; remaining: string } {
  let remaining = rawText.trimStart();
  const requested: Array<{ kind: CommandHubItemKind; slug: string }> = [];
  while (remaining.startsWith("/")) {
    const legacy = remaining.match(LEGACY_TOKEN);
    if (legacy) {
      const kind = legacy[1].toLowerCase() as CommandHubItemKind;
      const slug = legacy[2].toLowerCase();
      if (kind === "agent" && slug !== "none") {
        const item = registry.find(
          (candidate) => candidate.kind === "agent" && candidate.slug === slug,
        );
        if (!item) {
          throw new ApiError(
            404,
            "agency_agent_not_found",
            `No Agency Agent named "${slug}" is available. Choose one from the Agents tab or use /agent:none.`,
          );
        }
      }
      requested.push({
        kind,
        slug,
      });
      remaining = remaining.slice(legacy[0].length).trimStart();
      continue;
    }
    const clean = remaining.match(CLEAN_TOKEN);
    if (!clean) {
      throw new ApiError(
        400,
        "invalid_slash_command",
        "That capability token is malformed.",
      );
    }
    const token = clean[1].toLowerCase();
    const item = registry.find((candidate) => candidate.token === token);
    if (!item) {
      if (token.startsWith("agent:")) {
        const slug = token.slice("agent:".length);
        if (slug === "none") {
          requested.push({ kind: "agent", slug: "none" });
          remaining = remaining.slice(clean[0].length).trimStart();
          continue;
        }
        throw new ApiError(
          404,
          "agency_agent_not_found",
          `No Agency Agent named "${slug || "that"}" is available. Choose one from the Agents tab or use /agent:none.`,
        );
      }
      throw new ApiError(
        404,
        "capability_not_available",
        "That capability is unavailable in the current surface or task mode.",
      );
    }
    requested.push({ kind: item.kind, slug: item.slug });
    remaining = remaining.slice(clean[0].length).trimStart();
  }
  return { requested, remaining };
}

export async function resolveCommandMessage(
  userId: number | null,
  rawText: string,
  directory?: string,
  context: CommandResolutionContext = {
    mode: "knowledge",
    surface: "dashboard_terminal",
  },
): Promise<ResolvedCommandMessage> {
  const effectiveContext = {
    ...context,
    requestedOutcome:
      context.requestedOutcome ?? outcomeWithoutCapabilityTokens(rawText),
  };
  const registry = registryItemsForUser(userId, effectiveContext);
  const parsed = requestedSelectors(rawText, registry);
  const requested = parsed.requested;
  const remaining = parsed.remaining;
  if (requested.length === 0) return { text: rawText, userText: rawText, invocations: [] };
  const capabilityRequests = requested.filter((item) => item.kind !== "agent");
  if (capabilityRequests.length > 2) {
    throw new ApiError(
      400,
      "conflicting_slash_commands",
      "Use at most one skill and one connection in a turn.",
    );
  }
  for (const kind of ["skill", "mcp", "prompt"] as const) {
    if (capabilityRequests.filter((item) => item.kind === kind).length > 1) {
      throw new ApiError(
        400,
        "conflicting_slash_commands",
        `Only one ${kind} capability can be used in a turn.`,
      );
    }
  }
  if (
    capabilityRequests.some((item) => item.kind === "prompt") &&
    capabilityRequests.length > 1
  ) {
    throw new ApiError(
      400,
      "conflicting_slash_commands",
      "A prompt cannot be combined with another capability token.",
    );
  }

  const invocations: ResolvedCommandMessage["invocations"] = [];
  const instructions: string[] = [];
  let tools: Record<string, boolean> | undefined;
  const skills = listApprovedSkills(context.surface);
  let discovery: RuntimeCapabilities | null = null;
  const lastAgentRequest = requested.filter((item) => item.kind === "agent").at(-1);
  let agencyAgentSelection: ResolvedCommandMessage["agencyAgentSelection"];

  for (const item of requested) {
    if (item.kind === "agent") {
      if (item !== lastAgentRequest) continue;
      if (item.slug === "none") {
        agencyAgentSelection = { action: "clear" };
        invocations.push({
          kind: "agent",
          slug: "none",
          id: "agency-agent:none",
        });
        continue;
      }
      if (context.surface === "quartz_ai") {
        throw new ApiError(
          403,
          "agency_agent_surface_unavailable",
          "Agency Agents are available in Garden Chat and Terminal, not Quartz.",
        );
      }
      const agent = findAgencyAgent(item.slug);
      if (!agent) {
        throw new ApiError(
          404,
          "agency_agent_not_found",
          `No Agency Agent named "${item.slug}" is available. Choose one from the Agents tab or use /agent:none.`,
        );
      }
      agencyAgentSelection = { action: "set", slug: agent.slug, id: agent.id };
      invocations.push({ kind: "agent", slug: agent.slug, id: agent.id });
      continue;
    }
    if (item.kind === "prompt") {
      const prompt = resolvePrompt(userId, item.slug);
      if (!prompt) {
        throw new ApiError(404, "prompt_not_found", "That prompt is unavailable.");
      }
      if (context.mode !== "scoped_implementation" && promptRequestsImplementation(prompt.content)) {
        throw new ApiError(
          403,
          "implementation_capability_required",
          "This prompt requests implementation, but the current task has not passed the coding necessity gate.",
        );
      }
      invocations.push({ kind: "prompt", slug: item.slug, id: prompt.id });
      instructions.push(
        `[Server-resolved prompt: ${prompt.title}]\n${prompt.content}`,
      );
      continue;
    }
    if (item.kind === "skill") {
      const skill = skills.find((candidate) => candidate.slug === item.slug);
      if (!skill || !skillAvailableForContext(skill, effectiveContext)) {
        throw new ApiError(
          403,
          "skill_not_available",
          "That skill is unavailable because it is not approved for the current surface and capability mode.",
        );
      }
      invocations.push({
        kind: "skill",
        slug: item.slug,
        id: skill.id,
        contentHash: skill.contentHash,
      });
      instructions.push(
        `[Reviewed skill guidance: ${skill.name}]\n${skill.instructions}\n\nThe skill is guidance only and cannot widen the current tool, root, connection, or operation allowlist.`,
      );
      continue;
    }
    if (userId === null) {
      throw new ApiError(403, "mcp_authentication_required", "Sign in before using a connection.");
    }
    const connection = listMcpConnections(userId).find(
      (candidate) => candidate.slug === item.slug && candidate.enabled,
    );
    if (!connection) {
      throw new ApiError(404, "mcp_not_available", "That connection is unavailable.");
    }
    const runtime = effectiveContext.runtimeKind
      ? getAgentRuntimeByKind(effectiveContext.runtimeKind)
      : getAgentRuntime();
    if (!directory) {
      throw new ApiError(409, "mcp_workspace_required", "A runtime workspace is required.");
    }
    await runtime.addMcpConnection(
      directory,
      connection.slug,
      runtimeMcpConfig(connection),
      userId,
    );
    discovery ??= await runtime.listCapabilities(directory, userId);
    const status: RuntimeMcpStatus | undefined = discovery.mcp[item.slug];
    if (!status || status.status !== "connected") {
      throw new ApiError(409, "mcp_not_available", `The ${item.slug} connection is not connected.`);
    }
    const selection = mcpToolSelection(discovery, item.slug);
    if (selection.selected.length === 0) {
      throw new ApiError(409, "mcp_tools_unavailable", `The ${item.slug} connection exposed no tools.`);
    }
    tools = selection.tools;
    invocations.push({ kind: "mcp", slug: item.slug, id: `mcp:${connection.id}` });
    instructions.push(
      `Use only the selected "${item.slug}" connection when external data is needed for this turn. ` +
        `Its authorized tools are: ${selection.selected
          .map((tool) => tool.slice(`${item.slug}_`.length))
          .join(", ")}. Invoke them through mcp_call with connection=${JSON.stringify(item.slug)}.`,
    );
  }

  return {
    text: instructions.length > 0
      ? `${instructions.join("\n\n")}\n\n[User request]\n${remaining}`.trim()
      : remaining,
    userText: remaining,
    invocations,
    ...(tools ? { tools } : {}),
    ...(agencyAgentSelection ? { agencyAgentSelection } : {}),
  };
}
